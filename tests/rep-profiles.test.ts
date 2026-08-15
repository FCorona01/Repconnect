import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ANONYMOUS, type Actor } from '@/lib/auth/actor';
import { db } from '@/lib/db/client';
import { withActor } from '@/lib/db/rls';
import type { RepVisibility } from '@/lib/db/schema';
import {
  adminGetRepProfile,
  createRepProfile,
  getMyRepProfile,
  getRepProfileBySlug,
  setRepProfileVisibility,
  updateRepProfile,
} from '@/lib/repositories/rep-profiles';

import {
  actorFor,
  addMembership,
  closeDb,
  createOrganization,
  createUser,
} from './setup/fixtures';

afterAll(closeDb);

/** A rep with a profile at the given visibility. */
async function createRep(visibility: RepVisibility, headline = 'Enterprise closer') {
  const user = await createUser({ fullName: 'Rep Person' });
  const actor = await actorFor(user.id);

  const created = await createRepProfile(actor, {
    headline,
    bio: 'B'.repeat(120),
    yearsExperience: 10,
    seniority: 'enterprise_ae',
    visibility,
    industries: [{ slug: 'medical-devices', proficiency: 'expert', years: 8 }],
    territories: [{ slug: 'california' }],
    customerTypes: [{ slug: 'enterprise' }],
    salesModels: [{ slug: 'field-sales' }],
    compensationTypes: [{ slug: 'base-plus-commission' }],
  });

  if (!created.ok) throw new Error(`Fixture failed: ${created.error.message}`);

  return { user, actor: await actorFor(user.id), slug: created.data.slug, id: created.data.id };
}

// ===========================================================================
// THE VISIBILITY MATRIX
//
// Three visibility levels × four kinds of viewer. Every cell asserted.
//
// This is the control that decides whether a rep with a current employer is
// safe on RepConnect. Getting a single cell wrong could cost someone their job,
// so none of them are left to inference.
// ===========================================================================

describe('rep profile visibility matrix', () => {
  let anonymous: Actor;
  let plainUser: Actor;
  let businessMember: Actor;
  let admin: Actor;

  beforeAll(async () => {
    anonymous = ANONYMOUS;

    const plain = await createUser();
    plainUser = await actorFor(plain.id);

    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const member = await createUser();
    await addMembership(org.id, member.id, 'recruiter');
    businessMember = await actorFor(member.id);

    const adminUser = await createUser({ platformRole: 'admin' });
    admin = await actorFor(adminUser.id);
  });

  describe('visibility = public', () => {
    it('is visible to everyone, including anonymous visitors', async () => {
      const rep = await createRep('public');

      for (const [label, viewer] of [
        ['anonymous', anonymous],
        ['signed-in user', plainUser],
        ['business member', businessMember],
        ['admin', admin],
      ] as const) {
        const result = await getRepProfileBySlug(viewer, rep.slug);
        expect(result.ok, `${label} should see a public profile`).toBe(true);
      }
    });
  });

  describe('visibility = businesses_only (the default)', () => {
    it('is hidden from anonymous visitors', async () => {
      const rep = await createRep('businesses_only');
      const result = await getRepProfileBySlug(anonymous, rep.slug);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('not_found');
    });

    it('is hidden from a signed-in user who is not part of any business', async () => {
      // "Businesses only" must mean businesses — not merely "anyone with an
      // account", which would make the setting almost meaningless.
      const rep = await createRep('businesses_only');
      const result = await getRepProfileBySlug(plainUser, rep.slug);
      expect(result.ok).toBe(false);
    });

    it('is visible to a member of a business', async () => {
      const rep = await createRep('businesses_only');
      const result = await getRepProfileBySlug(businessMember, rep.slug);
      expect(result.ok).toBe(true);
    });

    it('is visible to its owner and to admins', async () => {
      const rep = await createRep('businesses_only');
      expect((await getRepProfileBySlug(rep.actor, rep.slug)).ok).toBe(true);
      expect((await getRepProfileBySlug(admin, rep.slug)).ok).toBe(true);
    });
  });

  describe('visibility = applied_only', () => {
    it('is hidden from everyone except the owner and admins', async () => {
      // Applications do not exist until Phase 4, so this currently resolves to
      // owner + admin. That is deliberately MORE restrictive than its final
      // behaviour: widening a permission later is safe, shipping it too wide
      // is not.
      const rep = await createRep('applied_only');

      expect((await getRepProfileBySlug(anonymous, rep.slug)).ok).toBe(false);
      expect((await getRepProfileBySlug(plainUser, rep.slug)).ok).toBe(false);
      expect((await getRepProfileBySlug(businessMember, rep.slug)).ok).toBe(false);

      expect((await getRepProfileBySlug(rep.actor, rep.slug)).ok).toBe(true);
      expect((await getRepProfileBySlug(admin, rep.slug)).ok).toBe(true);
    });
  });

  it('defaults to businesses_only when visibility is not specified', async () => {
    const user = await createUser();
    const created = await createRepProfile(await actorFor(user.id), {
      headline: 'Default visibility check',
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // The guarded option is the default. A rep who never touches the setting
    // must not be exposed publicly by omission.
    expect((await getRepProfileBySlug(ANONYMOUS, created.data.slug)).ok).toBe(false);
  });
});

// ===========================================================================
// Attribute visibility follows profile visibility
// ===========================================================================

describe('attribute rows inherit the profile visibility', () => {
  it('a hidden profile leaks none of its attributes, even by direct query', async () => {
    const rep = await createRep('applied_only');
    const outsider = await createUser();
    const outsiderActor = await actorFor(outsider.id);

    // Bypassing the repository entirely: the database must still refuse.
    const rows = await withActor(outsiderActor, async (tx) =>
      tx.execute(sql`
        select count(*)::int as n from rep_industries
        where rep_profile_id = ${rep.id}
      `),
    );

    const result = rows as unknown as Array<{ n: number }>;
    expect(result[0]?.n).toBe(0);
  });

  it('a visible profile exposes its attributes', async () => {
    const rep = await createRep('public');
    const outsider = await createUser();

    const result = await getRepProfileBySlug(await actorFor(outsider.id), rep.slug);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.industries).toHaveLength(1);
      expect(result.data.industries[0]?.slug).toBe('medical-devices');
      expect(result.data.territories[0]?.slug).toBe('california');
    }
  });
});

// ===========================================================================
// Private fields never reach a public view
// ===========================================================================

describe('field-level projection', () => {
  it('the public view has no compensation floor, email or start date', async () => {
    const rep = await createRep('public');
    await updateRepProfile(rep.actor, {
      headline: 'Enterprise closer',
      minBaseRequired: 90000,
      earliestStartDate: '2026-01-01',
    });

    const viewer = await createUser();
    const publicView = await getRepProfileBySlug(await actorFor(viewer.id), rep.slug);

    expect(publicView.ok).toBe(true);
    if (!publicView.ok) return;

    // Not "empty" — structurally absent. A public page cannot render a field
    // that does not exist on the type it was given.
    expect('minBaseRequired' in publicView.data).toBe(false);
    expect('email' in publicView.data).toBe(false);
    expect('earliestStartDate' in publicView.data).toBe(false);
  });

  it('viewing a profile does not make the rep\'s email reachable', async () => {
    // Rendering a profile needs the person's NAME, which lives on `users`
    // alongside their EMAIL. The tempting fix — letting anyone who can see a
    // profile read the users row — would hand out email addresses to every
    // business browsing the directory, because RLS is row-level, not
    // column-level. A narrow SECURITY DEFINER function exposes only the name.
    //
    // This test exists to stop that shortcut being taken later.
    const rep = await createRep('public');
    const owner = await createUser();
    const org = await createOrganization(owner.id);
    const viewer = await createUser();
    await addMembership(org.id, viewer.id, 'recruiter');
    const viewerActor = await actorFor(viewer.id);

    // The profile is readable...
    expect((await getRepProfileBySlug(viewerActor, rep.slug)).ok).toBe(true);

    // ...but the underlying users row is not, by any route.
    const direct = await withActor(viewerActor, async (tx) =>
      tx.execute(sql`
        select count(*)::int as n
        from users u
        join rep_profiles r on r.user_id = u.id
        where r.id = ${rep.id}
      `),
    );
    expect((direct as unknown as Array<{ n: number }>)[0]?.n).toBe(0);

    // And the display-name function returns the name only — never the email.
    const name = await withActor(viewerActor, async (tx) =>
      tx.execute(sql`select app.rep_display_name(${rep.id}) as full_name`),
    );
    expect((name as unknown as Array<{ full_name: string }>)[0]?.full_name).toBe(
      'Rep Person',
    );
  });

  it('a hidden profile does not leak the name either', async () => {
    const rep = await createRep('applied_only');
    const outsider = await createUser();
    const outsiderActor = await actorFor(outsider.id);

    const name = await withActor(outsiderActor, async (tx) =>
      tx.execute(sql`select app.rep_display_name(${rep.id}) as full_name`),
    );
    expect(
      (name as unknown as Array<{ full_name: string | null }>)[0]?.full_name,
    ).toBeNull();
  });

  it('the owner view includes them', async () => {
    const rep = await createRep('public');
    await updateRepProfile(rep.actor, {
      headline: 'Enterprise closer',
      minBaseRequired: 90000,
    });

    const mine = await getMyRepProfile(rep.actor);
    expect(mine.ok).toBe(true);
    if (mine.ok) {
      expect(mine.data.minBaseRequired).toBe('90000.00');
      expect(mine.data.email).toContain('@');
      expect(mine.data.completeness.score).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
// Ownership
// ===========================================================================

describe('rep profile ownership', () => {
  it('a user cannot edit another rep\'s profile', async () => {
    const rep = await createRep('public', 'Original headline');
    const attacker = await createUser();

    // updateRepProfile always targets the CALLER's own profile — there is no
    // parameter through which to name someone else's. The attacker has no
    // profile, so this is a not-found rather than a silent cross-edit.
    const result = await updateRepProfile(await actorFor(attacker.id), {
      headline: 'Hijacked',
    });

    expect(result.ok).toBe(false);

    const check = await getRepProfileBySlug(ANONYMOUS, rep.slug);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.data.headline).toBe('Original headline');
  });

  it('a direct database write against another rep is refused', async () => {
    const rep = await createRep('public');
    const attacker = await createUser();
    const attackerActor = await actorFor(attacker.id);

    await withActor(attackerActor, async (tx) =>
      tx.execute(sql`update rep_profiles set headline = 'Owned' where id = ${rep.id}`),
    );

    const check = await getRepProfileBySlug(ANONYMOUS, rep.slug);
    expect(check.ok && check.data.headline).not.toBe('Owned');
  });

  it('a user cannot add attributes to another rep\'s profile', async () => {
    const rep = await createRep('public');
    const attacker = await createUser();
    const attackerActor = await actorFor(attacker.id);

    let failed = false;
    try {
      await withActor(attackerActor, async (tx) =>
        tx.execute(sql`
          insert into rep_industries (rep_profile_id, industry_id)
          values (${rep.id}, (select id from industries where slug = 'b2b-saas'))
        `),
      );
    } catch {
      failed = true;
    }

    expect(failed).toBe(true);
  });

  it('one profile per user is enforced', async () => {
    const rep = await createRep('public');

    const second = await createRepProfile(rep.actor, { headline: 'Second profile' });

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('conflict');
  });

  it('anonymous callers cannot create a profile', async () => {
    const result = await createRepProfile(ANONYMOUS, { headline: 'Nope' });
    expect(result.ok).toBe(false);
  });

  it('only admins can use the admin read path', async () => {
    const rep = await createRep('applied_only');
    const other = await createUser();

    expect((await adminGetRepProfile(await actorFor(other.id), rep.id)).ok).toBe(false);

    const adminUser = await createUser({ platformRole: 'admin' });
    expect((await adminGetRepProfile(await actorFor(adminUser.id), rep.id)).ok).toBe(true);
  });
});

// ===========================================================================
// Validation and data integrity
// ===========================================================================

describe('rep profile validation', () => {
  it('rejects unknown taxonomy slugs rather than silently dropping them', async () => {
    const user = await createUser();

    const result = await createRepProfile(await actorFor(user.id), {
      headline: 'Test',
      industries: [{ slug: 'not-a-real-industry' }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
      expect(result.error.fields?.industries).toContain('not-a-real-industry');
    }
  });

  it('rejects a retired taxonomy entry', async () => {
    const adminUser = await createUser({ platformRole: 'admin' });
    const adminActor = await actorFor(adminUser.id);
    const slug = `retired-ind-${Date.now().toString(36)}`;

    const { createTaxonomyEntry, setTaxonomyEntryActive } = await import(
      '@/lib/repositories/taxonomy'
    );
    await createTaxonomyEntry(adminActor, 'industries', {
      slug,
      name: 'Retired Industry',
      parentSlug: 'software-technology',
    });
    await setTaxonomyEntryActive(adminActor, 'industries', slug, false);

    const user = await createUser();
    const result = await createRepProfile(await actorFor(user.id), {
      headline: 'Test',
      industries: [{ slug }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('validation');

    await db.execute(sql`delete from industries where slug = ${slug}`);
  });

  it('rejects unknown fields, closing mass assignment', async () => {
    const user = await createUser();

    const result = await createRepProfile(await actorFor(user.id), {
      headline: 'Test',
      profileCompleteness: 100,
      verificationStatus: 'verified',
    } as never);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('validation');
  });

  it('stores completeness computed from the profile, not from the caller', async () => {
    const rep = await createRep('public');
    const mine = await getMyRepProfile(rep.actor);

    expect(mine.ok).toBe(true);
    if (!mine.ok) return;

    const stored = await db.execute<{ profile_completeness: number }>(
      sql`select profile_completeness from rep_profiles where id = ${rep.id}`,
    );
    const row = (stored as unknown as Array<{ profile_completeness: number }>)[0];

    expect(row?.profile_completeness).toBe(mine.data.completeness.score);
    expect(row?.profile_completeness).toBeGreaterThan(0);
  });

  it('replacing attributes removes the ones no longer selected', async () => {
    const rep = await createRep('public');

    await updateRepProfile(rep.actor, {
      headline: 'Enterprise closer',
      industries: [{ slug: 'b2b-saas' }],
    });

    const result = await getRepProfileBySlug(ANONYMOUS, rep.slug);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.industries).toHaveLength(1);
      expect(result.data.industries[0]?.slug).toBe('b2b-saas');
    }
  });

  it('resolves territory ancestors for display', async () => {
    const user = await createUser();
    const actor = await actorFor(user.id);
    const created = await createRepProfile(actor, {
      headline: 'LA rep',
      visibility: 'public',
      territories: [{ slug: 'los-angeles-metro' }],
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await getRepProfileBySlug(ANONYMOUS, created.data.slug);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const territory = result.data.territories[0];
      expect(territory?.name).toBe('Los Angeles Metro');
      expect(territory?.ancestors).toEqual([
        'Anywhere / Fully Remote',
        'United States (Nationwide)',
        'West',
        'California',
      ]);
    }
  });

  it('the slug is immutable once issued', async () => {
    const rep = await createRep('public');

    let failed = false;
    try {
      await db.execute(
        sql`update rep_profiles set slug = 'new-slug-attempt' where id = ${rep.id}`,
      );
    } catch {
      failed = true;
    }

    expect(failed).toBe(true);
  });
});

// ===========================================================================
// Visibility changes are audited
// ===========================================================================

describe('visibility changes', () => {
  it('are recorded in the audit log', async () => {
    const rep = await createRep('businesses_only');

    const changed = await setRepProfileVisibility(rep.actor, 'public');
    expect(changed.ok).toBe(true);

    const entries = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from audit_logs
      where action = 'rep_profile.visibility_changed' and target_id = ${rep.id}
    `);

    const row = (entries as unknown as Array<{ n: number }>)[0];
    expect(row?.n).toBe(1);

    // And the change takes effect immediately.
    expect((await getRepProfileBySlug(ANONYMOUS, rep.slug)).ok).toBe(true);
  });

  it('narrowing visibility hides the profile again', async () => {
    const rep = await createRep('public');
    expect((await getRepProfileBySlug(ANONYMOUS, rep.slug)).ok).toBe(true);

    await setRepProfileVisibility(rep.actor, 'applied_only');
    expect((await getRepProfileBySlug(ANONYMOUS, rep.slug)).ok).toBe(false);
  });
});
