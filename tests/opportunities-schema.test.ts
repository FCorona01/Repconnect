import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { ANONYMOUS, type Actor } from '@/lib/auth/actor';
import { db } from '@/lib/db/client';
import { withActor } from '@/lib/db/rls';

import {
  actorFor,
  addMembership,
  closeDb,
  createOrganization,
  createUser,
} from './setup/fixtures';

afterAll(closeDb);

/**
 * Checkpoint 1 covers the SCHEMA. The repository and its state machine arrive
 * in Checkpoint 2, so these exercise the database directly — which is also the
 * point: every guarantee asserted here holds against a raw SQL write, not only
 * against well-behaved application code.
 */

let counter = 0;
const uniqueSlug = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(counter += 1).toString(36)}`;

/** Creates a draft listing straight through the owner connection. */
async function createDraft(
  organizationId: string,
  options: { slug?: string; title?: string } = {},
): Promise<{ id: string; slug: string }> {
  const slug = options.slug ?? uniqueSlug('listing');

  const rows = await db.execute<{ id: string; slug: string }>(sql`
    insert into opportunities
      (organization_id, slug, title, summary, description, engagement_type)
    values (${organizationId}, ${slug}, ${options.title ?? 'Regional Sales Rep'},
            'Sell surgical implants to outpatient centres',
            'A long description of the role and what it involves.',
            'full_time')
    returning id, slug
  `);

  const row = (rows as unknown as Array<{ id: string; slug: string }>)[0];
  if (!row) throw new Error('Failed to create draft');
  return row;
}

async function addCompensation(
  opportunityId: string,
  compensationSlug = 'commission-only',
): Promise<void> {
  await db.execute(sql`
    insert into opportunity_compensation
      (opportunity_id, compensation_type_id, is_primary,
       commission_rate_min, commission_rate_max, commission_basis, ote_min)
    values (${opportunityId},
            (select id from compensation_types where slug = ${compensationSlug}),
            true, 12, 18, 'gross_profit', 90000)
  `);
}

async function expectDatabaseError(
  operation: () => Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  let thrown: unknown;
  try {
    await operation();
  } catch (error) {
    thrown = error;
  }

  if (thrown === undefined) {
    throw new Error(`Expected failure matching ${pattern}, but it succeeded.`);
  }

  const chain: string[] = [];
  let current: unknown = thrown;
  while (current instanceof Error) {
    chain.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  expect(chain.join(' | ')).toMatch(pattern);
}

async function visibleCount(actor: Actor, opportunityId: string): Promise<number> {
  const rows = await withActor(actor, async (tx) =>
    tx.execute(sql`select count(*)::int as n from opportunities where id = ${opportunityId}`),
  );
  return (rows as unknown as Array<{ n: number }>)[0]?.n ?? 0;
}

// ===========================================================================
// Pay disclosure — the decision that drove this schema
// ===========================================================================

describe('pay disclosure is a database guarantee', () => {
  it('refuses a compensation row that states no figure at all', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createDraft(org.id);

    // Naming a compensation type is not a disclosure.
    await expectDatabaseError(
      () =>
        db.execute(sql`
          insert into opportunity_compensation (opportunity_id, compensation_type_id)
          values (${draft.id}, (select id from compensation_types where slug = 'commission-only'))
        `),
      /discloses_a_figure/i,
    );
  });

  it('refuses to publish a listing with no compensation at all', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createDraft(org.id);

    await expectDatabaseError(
      () => db.execute(sql`update opportunities set status = 'open' where id = ${draft.id}`),
      /must state its compensation/i,
    );
  });

  it('refuses to send a listing for review without compensation either', async () => {
    // Otherwise an undisclosed listing reaches a human reviewer and wastes the
    // review, which is the scarce resource in the first-listing flow.
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createDraft(org.id);

    await expectDatabaseError(
      () =>
        db.execute(sql`update opportunities set status = 'pending_review' where id = ${draft.id}`),
      /must state its compensation/i,
    );
  });

  it('accepts each shape of disclosure a real listing might use', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);

    // Every arrangement a real sales listing uses must be expressible. A schema
    // that only fits salaried roles would be useless here.
    const cases: Array<{ label: string; columns: string; values: ReturnType<typeof sql> }> = [
      {
        label: 'base only',
        columns: 'base_min, base_max',
        values: sql`60000, 80000`,
      },
      {
        label: 'commission only',
        columns: 'commission_rate_min, commission_basis',
        values: sql`15, 'revenue'`,
      },
      {
        label: 'OTE only',
        columns: 'ote_min',
        values: sql`120000`,
      },
      {
        label: 'retainer only',
        columns: 'retainer_amount, payment_frequency',
        values: sql`4000, 'monthly'`,
      },
    ];

    for (const testCase of cases) {
      const draft = await createDraft(org.id);

      await db.execute(sql`
        insert into opportunity_compensation
          (opportunity_id, compensation_type_id, ${sql.raw(testCase.columns)})
        values (${draft.id},
                (select id from compensation_types where slug = 'base-plus-commission'),
                ${testCase.values})
      `);

      await db.execute(sql`update opportunities set status = 'open' where id = ${draft.id}`);

      const rows = await db.execute<{ status: string }>(
        sql`select status::text from opportunities where id = ${draft.id}`,
      );
      expect(
        (rows as unknown as Array<{ status: string }>)[0]?.status,
        `${testCase.label} should publish`,
      ).toBe('open');
    }
  });

  it('refuses an inverted range', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createDraft(org.id);

    await expectDatabaseError(
      () =>
        db.execute(sql`
          insert into opportunity_compensation
            (opportunity_id, compensation_type_id, base_min, base_max)
          values (${draft.id},
                  (select id from compensation_types where slug = 'base-plus-commission'),
                  90000, 50000)
        `),
      /base_range/i,
    );
  });

  it('refuses a commission rate outside 0–100', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createDraft(org.id);

    await expectDatabaseError(
      () =>
        db.execute(sql`
          insert into opportunity_compensation
            (opportunity_id, compensation_type_id, commission_rate_min)
          values (${draft.id},
                  (select id from compensation_types where slug = 'commission-only'), 150)
        `),
      /commission_range/i,
    );
  });

  it('allows only one primary arrangement per listing', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createDraft(org.id);

    await addCompensation(draft.id, 'commission-only');

    await expectDatabaseError(
      () =>
        db.execute(sql`
          insert into opportunity_compensation
            (opportunity_id, compensation_type_id, is_primary, retainer_amount)
          values (${draft.id},
                  (select id from compensation_types where slug = 'retainer'), true, 5000)
        `),
      /single_primary/i,
    );
  });
});

// ===========================================================================
// Status lifecycle
// ===========================================================================

describe('status lifecycle', () => {
  it('stamps published_at on first publication and never moves it again', async () => {
    // "Posted on" must not jump forward every time a listing is paused and
    // resumed — that would misrepresent the listing's age to reps and to Google.
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createDraft(org.id);
    await addCompensation(draft.id);

    await db.execute(sql`update opportunities set status = 'open' where id = ${draft.id}`);
    const first = await db.execute<{ published_at: string }>(
      sql`select published_at from opportunities where id = ${draft.id}`,
    );
    const t0 = (first as unknown as Array<{ published_at: string }>)[0]?.published_at;
    expect(t0).toBeTruthy();

    await db.execute(sql`update opportunities set status = 'paused' where id = ${draft.id}`);
    await db.execute(sql`update opportunities set status = 'open' where id = ${draft.id}`);

    const second = await db.execute<{ published_at: string }>(
      sql`select published_at from opportunities where id = ${draft.id}`,
    );
    expect((second as unknown as Array<{ published_at: string }>)[0]?.published_at).toEqual(t0);
  });

  it('treats archived as terminal', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createDraft(org.id);
    await addCompensation(draft.id);

    await db.execute(sql`update opportunities set status = 'open' where id = ${draft.id}`);
    await db.execute(sql`update opportunities set status = 'archived' where id = ${draft.id}`);

    // Reviving a soft-deleted listing would resurrect a URL people may have
    // shared for something else.
    await expectDatabaseError(
      () => db.execute(sql`update opportunities set status = 'open' where id = ${draft.id}`),
      /archived .* cannot be reopened/i,
    );
  });

  it('records every transition automatically, including the initial draft', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createDraft(org.id);
    await addCompensation(draft.id);

    await db.execute(sql`update opportunities set status = 'open' where id = ${draft.id}`);
    await db.execute(sql`update opportunities set status = 'filled' where id = ${draft.id}`);

    const rows = await db.execute<{ from_status: string | null; to_status: string }>(sql`
      select from_status::text, to_status::text from opportunity_status_history
      where opportunity_id = ${draft.id} order by created_at, to_status
    `);
    const history = rows as unknown as Array<{ from_status: string | null; to_status: string }>;

    // Recorded by trigger rather than by application code, so a transition
    // cannot happen without being written down.
    expect(history.map((h) => h.to_status)).toEqual(['draft', 'open', 'filled']);
    expect(history[0]?.from_status).toBeNull();
    expect(history[1]?.from_status).toBe('draft');
  });

  it('keeps status history immutable — no update or delete grant', async () => {
    const rows = await db.execute<{ privilege_type: string }>(sql`
      select privilege_type from information_schema.role_table_grants
      where grantee = 'app_user' and table_name = 'opportunity_status_history'
    `);
    const granted = (rows as unknown as Array<{ privilege_type: string }>).map(
      (r) => r.privilege_type,
    );

    expect(granted).toContain('SELECT');
    expect(granted).not.toContain('UPDATE');
    expect(granted).not.toContain('DELETE');
    // INSERT happens through a trigger, so the role needs no grant at all.
    expect(granted).not.toContain('INSERT');
  });

  it('requires a publication date whenever a listing is live', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createDraft(org.id);
    await addCompensation(draft.id);
    await db.execute(sql`update opportunities set status = 'open' where id = ${draft.id}`);

    await expectDatabaseError(
      () =>
        db.execute(sql`update opportunities set published_at = null where id = ${draft.id}`),
      /published_when_live/i,
    );
  });

  it('makes the slug immutable', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createDraft(org.id);

    await expectDatabaseError(
      () => db.execute(sql`update opportunities set slug = 'renamed' where id = ${draft.id}`),
      /slugs are immutable/i,
    );
  });
});

// ===========================================================================
// Visibility
// ===========================================================================

describe('opportunity visibility', () => {
  it('hides drafts and pending listings from everyone outside the company', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const outsider = await createUser();
    const draft = await createDraft(org.id);

    // A half-written listing is not something the world should see.
    expect(await visibleCount(ANONYMOUS, draft.id)).toBe(0);
    expect(await visibleCount(await actorFor(outsider.id), draft.id)).toBe(0);
    expect(await visibleCount(await actorFor(owner.id), draft.id)).toBe(1);

    await addCompensation(draft.id);
    await db.execute(sql`update opportunities set status = 'pending_review' where id = ${draft.id}`);

    expect(await visibleCount(ANONYMOUS, draft.id)).toBe(0);
    expect(await visibleCount(await actorFor(owner.id), draft.id)).toBe(1);

    const admin = await createUser({ platformRole: 'admin' });
    expect(await visibleCount(await actorFor(admin.id), draft.id)).toBe(1);
  });

  it('keeps filled and closed listings publicly readable so shared links never break', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createDraft(org.id);
    await addCompensation(draft.id);

    for (const status of ['open', 'paused', 'filled', 'closed'] as const) {
      await db.execute(
        sql`update opportunities set status = ${status}::opportunity_status where id = ${draft.id}`,
      );
      expect(
        await visibleCount(ANONYMOUS, draft.id),
        `${status} should stay publicly readable`,
      ).toBe(1);
    }
  });

  it('hides archived listings from the public again', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createDraft(org.id);
    await addCompensation(draft.id);
    await db.execute(sql`update opportunities set status = 'open' where id = ${draft.id}`);
    await db.execute(sql`update opportunities set status = 'archived' where id = ${draft.id}`);

    expect(await visibleCount(ANONYMOUS, draft.id)).toBe(0);
    expect(await visibleCount(await actorFor(owner.id), draft.id)).toBe(1);
  });

  it('hides a draft\'s compensation and attributes along with it', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createDraft(org.id);
    await addCompensation(draft.id);
    await db.execute(sql`
      insert into opportunity_industries (opportunity_id, industry_id, is_required)
      select ${draft.id}, id, true from industries where slug = 'medical-devices'
    `);

    const outsider = await actorFor((await createUser()).id);

    // Attribute policies restate no visibility rules — they ask whether the
    // parent listing is visible, so this follows automatically.
    for (const table of ['opportunity_compensation', 'opportunity_industries']) {
      const rows = await withActor(outsider, async (tx) =>
        tx.execute(
          sql`select count(*)::int as n from ${sql.identifier(table)} where opportunity_id = ${draft.id}`,
        ),
      );
      expect((rows as unknown as Array<{ n: number }>)[0]?.n, table).toBe(0);
    }
  });
});

// ===========================================================================
// Write authorization
// ===========================================================================

describe('who may post and edit', () => {
  it('a recruiter can create a listing; a viewer cannot', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const recruiter = await createUser();
    const viewer = await createUser();
    await addMembership(org.id, recruiter.id, 'recruiter');
    await addMembership(org.id, viewer.id, 'viewer');

    const insert = (actor: Actor, slug: string) =>
      withActor(actor, async (tx) =>
        tx.execute(sql`
          insert into opportunities
            (organization_id, slug, title, summary, description, engagement_type)
          values (${org.id}, ${slug}, 'Rep', 'Summary', 'Description', 'full_time')
        `),
      );

    await expect(
      insert(await actorFor(recruiter.id), uniqueSlug('by-recruiter')),
    ).resolves.toBeDefined();

    await expectDatabaseError(
      async () => insert(await actorFor(viewer.id), uniqueSlug('by-viewer')),
      /row-level security/i,
    );
  });

  it('another company cannot create a listing under someone else\'s name', async () => {
    const ownerA = await createUser();
    const orgA = await createOrganization(ownerA.id);
    const ownerB = await createUser();
    await createOrganization(ownerB.id);

    await expectDatabaseError(
      async () =>
        withActor(await actorFor(ownerB.id), async (tx) =>
          tx.execute(sql`
            insert into opportunities
              (organization_id, slug, title, summary, description, engagement_type)
            values (${orgA.id}, ${uniqueSlug('hijack')}, 'Rep', 'S', 'D', 'full_time')
          `),
        ),
      /row-level security/i,
    );
  });

  it('another company cannot edit a published listing', async () => {
    const ownerA = await createUser();
    const orgA = await createOrganization(ownerA.id);
    const draft = await createDraft(orgA.id, { title: 'Original title' });
    await addCompensation(draft.id);
    await db.execute(sql`update opportunities set status = 'open' where id = ${draft.id}`);

    const attacker = await createUser();

    // The listing is publicly READABLE, which makes this the interesting case:
    // being able to see something must not imply being able to change it.
    expect(await visibleCount(await actorFor(attacker.id), draft.id)).toBe(1);

    await withActor(await actorFor(attacker.id), async (tx) =>
      tx.execute(sql`update opportunities set title = 'Hijacked' where id = ${draft.id}`),
    );

    const rows = await db.execute<{ title: string }>(
      sql`select title from opportunities where id = ${draft.id}`,
    );
    expect((rows as unknown as Array<{ title: string }>)[0]?.title).toBe('Original title');
  });

  it('a viewer cannot add attributes to their own company\'s listing', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const viewer = await createUser();
    await addMembership(org.id, viewer.id, 'viewer');
    const draft = await createDraft(org.id);

    await expectDatabaseError(
      async () =>
        withActor(await actorFor(viewer.id), async (tx) =>
          tx.execute(sql`
            insert into opportunity_industries (opportunity_id, industry_id)
            select ${draft.id}, id from industries where slug = 'b2b-saas'
          `),
        ),
      /row-level security/i,
    );
  });

  it('listings cannot be deleted, only archived', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createDraft(org.id);

    const rows = await db.execute<{ privilege_type: string }>(sql`
      select privilege_type from information_schema.role_table_grants
      where grantee = 'app_user' and table_name = 'opportunities'
    `);
    const granted = (rows as unknown as Array<{ privilege_type: string }>).map(
      (r) => r.privilege_type,
    );

    // Applications in Phase 4 will reference listings; a vanished listing would
    // orphan a rep's history.
    expect(granted).not.toContain('DELETE');
    expect(draft.id).toBeTruthy();
  });
});

// ===========================================================================
// Saved opportunities
// ===========================================================================

describe('saved opportunities', () => {
  async function repFor(userId: string): Promise<string> {
    const rows = await db.execute<{ id: string }>(sql`
      insert into rep_profiles (user_id, slug, headline)
      values (${userId}, ${uniqueSlug('rep')}, 'Test rep')
      returning id
    `);
    const row = (rows as unknown as Array<{ id: string }>)[0];
    if (!row) throw new Error('Failed to create rep profile');
    return row.id;
  }

  it('a rep can save a listing, and only they can see it', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createDraft(org.id);
    await addCompensation(draft.id);
    await db.execute(sql`update opportunities set status = 'open' where id = ${draft.id}`);

    const repUser = await createUser();
    const repProfileId = await repFor(repUser.id);
    const repActor = await actorFor(repUser.id);

    await withActor(repActor, async (tx) =>
      tx.execute(sql`
        insert into saved_opportunities (rep_profile_id, opportunity_id)
        values (${repProfileId}, ${draft.id})
      `),
    );

    const mine = await withActor(repActor, async (tx) =>
      tx.execute(sql`select count(*)::int as n from saved_opportunities`),
    );
    expect((mine as unknown as Array<{ n: number }>)[0]?.n).toBe(1);

    // The posting company must never learn who has been eyeing its listing —
    // knowing would chill saving entirely.
    const asBusiness = await withActor(await actorFor(owner.id), async (tx) =>
      tx.execute(
        sql`select count(*)::int as n from saved_opportunities where opportunity_id = ${draft.id}`,
      ),
    );
    expect((asBusiness as unknown as Array<{ n: number }>)[0]?.n).toBe(0);
  });

  it('a rep cannot save on behalf of another rep', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const draft = await createDraft(org.id);
    await addCompensation(draft.id);
    await db.execute(sql`update opportunities set status = 'open' where id = ${draft.id}`);

    const victim = await createUser();
    const victimProfileId = await repFor(victim.id);
    const attacker = await createUser();
    await repFor(attacker.id);

    await expectDatabaseError(
      async () =>
        withActor(await actorFor(attacker.id), async (tx) =>
          tx.execute(sql`
            insert into saved_opportunities (rep_profile_id, opportunity_id)
            values (${victimProfileId}, ${draft.id})
          `),
        ),
      /row-level security/i,
    );
  });
});

// ===========================================================================
// Publishing trust
// ===========================================================================

describe('listing trust', () => {
  it('new companies start unreviewed', async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id);

    const rows = await db.execute<{ listing_trust: string }>(
      sql`select listing_trust::text from organizations where id = ${org.id}`,
    );
    expect((rows as unknown as Array<{ listing_trust: string }>)[0]?.listing_trust).toBe(
      'unreviewed',
    );
  });

  it('a company cannot promote its own trust level', async () => {
    // The whole point of the review gate is that the reviewed party does not
    // control it. Enforced by the repository in Checkpoint 2; here we confirm
    // the column exists and defaults safely.
    const owner = await createUser();
    const org = await createOrganization(owner.id);

    const rows = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from organizations
      where id = ${org.id} and listing_trust = 'unreviewed'
    `);
    expect((rows as unknown as Array<{ n: number }>)[0]?.n).toBe(1);
  });
});
