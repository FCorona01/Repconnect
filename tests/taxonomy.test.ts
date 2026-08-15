import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { ANONYMOUS } from '@/lib/auth/actor';
import { db } from '@/lib/db/client';
import { withActor } from '@/lib/db/rls';
import {
  createTaxonomyEntry,
  getTerritoryAncestors,
  listCompensationTypes,
  listCustomerTypes,
  listIndustries,
  listSalesModels,
  listTerritories,
  setTaxonomyEntryActive,
} from '@/lib/repositories/taxonomy';

import { actorFor, closeDb, createUser } from './setup/fixtures';

afterAll(closeDb);

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await db.execute(query);
  return result as unknown as T[];
}

/**
 * Asserts an operation fails for a specific database-level reason.
 *
 * Drizzle wraps driver errors in a generic "Failed query: ..." Error and puts
 * the real PostgresError on `cause`. Matching the wrapper would pass for ANY
 * failure — including the operation failing for the wrong reason — so this
 * walks the cause chain and matches against the underlying message.
 */
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
    throw new Error(`Expected the operation to fail with ${pattern}, but it succeeded.`);
  }

  const chain: string[] = [];
  let current: unknown = thrown;
  while (current instanceof Error) {
    chain.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }

  expect(chain.join(' | ')).toMatch(pattern);
}

async function territoryIdBySlug(slug: string): Promise<string> {
  const found = await rows<{ id: string }>(
    sql`select id from territories where slug = ${slug}`,
  );
  const id = found[0]?.id;
  if (!id) throw new Error(`No territory ${slug}`);
  return id;
}

// ===========================================================================
// Hierarchy integrity
//
// Bad hierarchy data is invisible until matching silently returns wrong
// results, so these assert the structure directly rather than trusting the
// seed script.
// ===========================================================================

describe('hierarchy integrity', () => {
  it.each(['industries', 'product_categories', 'territories'])(
    '%s: every path equals the parent path plus its own label',
    async (table) => {
      const broken = await rows<{ slug: string }>(sql`
        select c.slug
        from ${sql.identifier(table)} c
        join ${sql.identifier(table)} p on p.id = c.parent_id
        where c.path <> (p.path || app.slug_to_label(c.slug)::ltree)
      `);
      expect(broken.map((r) => r.slug)).toEqual([]);
    },
  );

  it.each(['industries', 'product_categories', 'territories'])(
    '%s: no orphans — every parent_id resolves',
    async (table) => {
      const orphans = await rows<{ slug: string }>(sql`
        select c.slug
        from ${sql.identifier(table)} c
        where c.parent_id is not null
          and not exists (select 1 from ${sql.identifier(table)} p where p.id = c.parent_id)
      `);
      expect(orphans.map((r) => r.slug)).toEqual([]);
    },
  );

  it.each(['industries', 'product_categories', 'territories'])(
    '%s: root nodes have a single-label path',
    async (table) => {
      const bad = await rows<{ slug: string }>(sql`
        select slug from ${sql.identifier(table)}
        where parent_id is null and nlevel(path) <> 1
      `);
      expect(bad.map((r) => r.slug)).toEqual([]);
    },
  );

  it('territories have exactly one root, and it is the global node', async () => {
    const roots = await rows<{ slug: string; kind: string }>(
      sql`select slug, kind from territories where parent_id is null`,
    );
    expect(roots).toHaveLength(1);
    expect(roots[0]?.slug).toBe('anywhere');
    expect(roots[0]?.kind).toBe('global');
  });

  it('territory kinds nest in the expected order', async () => {
    const wrong = await rows<{ slug: string }>(sql`
      select c.slug
      from territories c
      join territories p on p.id = c.parent_id
      where (c.kind, p.kind) not in (
        ('country','global'), ('region','country'),
        ('subdivision','region'), ('metro','subdivision')
      )
    `);
    expect(wrong.map((r) => r.slug)).toEqual([]);
  });

  it('seeded US and Canada subdivision counts are correct', async () => {
    const counts = await rows<{ country: string; n: number }>(sql`
      select split_part(path::text, '.', 2) as country, count(*)::int as n
      from territories where kind = 'subdivision'
      group by 1 order by 1
    `);
    const byCountry = Object.fromEntries(counts.map((c) => [c.country, c.n]));
    expect(byCountry.united_states).toBe(51); // 50 states + District of Columbia
    expect(byCountry.canada).toBe(13); // 10 provinces + 3 territories
  });

  it('every subdivision declares what kind of subdivision it is', async () => {
    const missing = await rows<{ slug: string }>(sql`
      select slug from territories where kind = 'subdivision' and subdivision_type is null
    `);
    expect(missing).toEqual([]);
  });
});

// ===========================================================================
// The matching rule
// ===========================================================================

describe('path overlap — the rule all territory and industry matching rests on', () => {
  const overlap = async (table: string, a: string, b: string): Promise<boolean> => {
    const result = await rows<{ overlaps: boolean }>(sql`
      select app.paths_overlap(
        (select path from ${sql.identifier(table)} where slug = ${a}),
        (select path from ${sql.identifier(table)} where slug = ${b})
      ) as overlaps
    `);
    return result[0]?.overlaps ?? false;
  };

  it('a rep covering a state matches an opportunity in one of its metros', async () => {
    expect(await overlap('territories', 'california', 'los-angeles-metro')).toBe(true);
  });

  it('a rep covering only a metro matches an opportunity scoped to the state', async () => {
    expect(await overlap('territories', 'los-angeles-metro', 'california')).toBe(true);
  });

  it('nationwide matches everything inside that country', async () => {
    expect(await overlap('territories', 'united-states', 'los-angeles-metro')).toBe(true);
    expect(await overlap('territories', 'united-states', 'texas')).toBe(true);
  });

  it('anywhere/fully-remote matches every territory', async () => {
    expect(await overlap('territories', 'anywhere', 'toronto-on')).toBe(true);
    expect(await overlap('territories', 'anywhere', 'los-angeles-metro')).toBe(true);
  });

  it('unrelated territories do not match', async () => {
    expect(await overlap('territories', 'california', 'texas')).toBe(false);
    expect(await overlap('territories', 'california', 'toronto-on')).toBe(false);
    expect(await overlap('territories', 'united-states', 'ontario')).toBe(false);
  });

  it('the same rule governs industries', async () => {
    expect(await overlap('industries', 'healthcare-life-sciences', 'medical-devices')).toBe(true);
    expect(await overlap('industries', 'medical-devices', 'healthcare-life-sciences')).toBe(true);
    expect(await overlap('industries', 'medical-devices', 'b2b-saas')).toBe(false);
  });

  it('null paths never match, rather than matching everything', async () => {
    const result = await rows<{ a: boolean; b: boolean }>(sql`
      select app.paths_overlap(null, 'anywhere'::ltree) as a,
             app.paths_overlap('anywhere'::ltree, null) as b
    `);
    expect(result[0]?.a).toBe(false);
    expect(result[0]?.b).toBe(false);
  });
});

// ===========================================================================
// Triggers — path is a database guarantee, not a convention
// ===========================================================================

describe('hierarchy maintenance triggers', () => {
  it('derives path on insert without application code supplying it', async () => {
    const admin = await createUser({ platformRole: 'admin' });
    const slug = `test-derived-${Date.now().toString(36)}`;

    const created = await createTaxonomyEntry(await actorFor(admin.id), 'industries', {
      slug,
      name: 'Derived Path Test',
      parentSlug: 'healthcare-life-sciences',
    });

    expect(created.ok).toBe(true);

    const result = await rows<{ path: string }>(
      sql`select path::text from industries where slug = ${slug}`,
    );
    expect(result[0]?.path).toBe(
      `healthcare_life_sciences.${slug.replace(/-/g, '_')}`,
    );

    await db.execute(sql`delete from industries where slug = ${slug}`);
  });

  it('refuses to change a slug, because slugs are the public contract', async () => {
    await expectDatabaseError(
      () =>
        db.execute(sql`update industries set slug = 'renamed-industry' where slug = 'b2b-saas'`),
      /slugs are immutable/i,
    );
  });

  it('moves the whole subtree when a node is re-parented', async () => {
    const stamp = Date.now().toString(36);
    const parentA = `move-a-${stamp}`;
    const parentB = `move-b-${stamp}`;
    const child = `move-child-${stamp}`;
    const grandchild = `move-grandchild-${stamp}`;

    await db.execute(sql`
      insert into industries (slug, name) values (${parentA}, 'A'), (${parentB}, 'B')
    `);
    await db.execute(sql`
      insert into industries (slug, name, parent_id)
      values (${child}, 'Child', (select id from industries where slug = ${parentA}))
    `);
    await db.execute(sql`
      insert into industries (slug, name, parent_id)
      values (${grandchild}, 'Grandchild', (select id from industries where slug = ${child}))
    `);

    // Re-parent the child from A to B.
    await db.execute(sql`
      update industries
         set parent_id = (select id from industries where slug = ${parentB})
       where slug = ${child}
    `);

    const paths = await rows<{ slug: string; path: string }>(sql`
      select slug, path::text as path from industries
      where slug in (${child}, ${grandchild}) order by slug
    `);
    const bySlug = Object.fromEntries(paths.map((p) => [p.slug, p.path]));

    const labelB = parentB.replace(/-/g, '_');
    const labelChild = child.replace(/-/g, '_');

    expect(bySlug[child]).toBe(`${labelB}.${labelChild}`);
    // The descendant must follow. If it did not, it would silently stop
    // matching anything under its new ancestor.
    expect(bySlug[grandchild]).toBe(
      `${labelB}.${labelChild}.${grandchild.replace(/-/g, '_')}`,
    );

    await db.execute(sql`
      delete from industries where slug in (${grandchild}, ${child}, ${parentA}, ${parentB})
    `);
  });

  it('refuses to create a cycle', async () => {
    const stamp = Date.now().toString(36);
    const parent = `cycle-p-${stamp}`;
    const child = `cycle-c-${stamp}`;

    await db.execute(sql`insert into industries (slug, name) values (${parent}, 'P')`);
    await db.execute(sql`
      insert into industries (slug, name, parent_id)
      values (${child}, 'C', (select id from industries where slug = ${parent}))
    `);

    await expectDatabaseError(
      () =>
        db.execute(sql`
          update industries
             set parent_id = (select id from industries where slug = ${child})
           where slug = ${parent}
        `),
      /own descendant/i,
    );

    await db.execute(sql`delete from industries where slug in (${child}, ${parent})`);
  });

  it('refuses to delete an entry that other rows reference', async () => {
    // ON DELETE RESTRICT: retiring is the supported operation, not deleting.
    await expectDatabaseError(
      () => db.execute(sql`delete from industries where slug = 'healthcare-life-sciences'`),
      /violates foreign key constraint/i,
    );
  });
});

// ===========================================================================
// Authorization
// ===========================================================================

describe('taxonomy authorization', () => {
  it('anonymous visitors can read every vocabulary', async () => {
    const [industriesResult, territoriesResult, customers, models, comp] = await Promise.all([
      listIndustries(ANONYMOUS),
      listTerritories(ANONYMOUS, { maxDepth: 2 }),
      listCustomerTypes(ANONYMOUS),
      listSalesModels(ANONYMOUS),
      listCompensationTypes(ANONYMOUS),
    ]);

    expect(industriesResult.ok).toBe(true);
    if (industriesResult.ok) expect(industriesResult.data.length).toBeGreaterThan(15);

    expect(territoriesResult.ok).toBe(true);
    if (territoriesResult.ok) {
      expect(territoriesResult.data).toHaveLength(1);
      expect(territoriesResult.data[0]?.slug).toBe('anywhere');
      expect(territoriesResult.data[0]?.children).toHaveLength(2);
    }

    expect(customers.ok && customers.data.length).toBe(8);
    expect(models.ok && models.data.length).toBe(8);
    expect(comp.ok && comp.data.length).toBe(7);
  });

  it('a normal member cannot create a taxonomy entry', async () => {
    const user = await createUser();

    const result = await createTaxonomyEntry(await actorFor(user.id), 'industries', {
      slug: 'member-should-not-create',
      name: 'Nope',
    });

    expect(result.ok).toBe(false);
  });

  it('a normal member cannot write taxonomy directly — RLS refuses it', async () => {
    const user = await createUser();
    const actor = await actorFor(user.id);

    // Bypassing the repository entirely still fails, because the database
    // enforces the same rule independently of application code.
    await expectDatabaseError(
      () =>
        withActor(actor, async (tx) =>
          tx.execute(sql`insert into industries (slug, name) values ('rls-bypass-attempt', 'X')`),
        ),
      /row-level security/i,
    );

    // An UPDATE the policy forbids matches zero rows rather than erroring —
    // so the assertion that matters is that the data is unchanged, below.
    await withActor(actor, async (tx) =>
      tx.execute(sql`update industries set name = 'Hijacked' where slug = 'b2b-saas'`),
    );

    const check = await rows<{ name: string }>(
      sql`select name from industries where slug = 'b2b-saas'`,
    );
    expect(check[0]?.name).toBe('B2B SaaS');
  });

  it('a member cannot delete taxonomy', async () => {
    const user = await createUser();
    const actor = await actorFor(user.id);

    await withActor(actor, async (tx) =>
      tx.execute(sql`delete from customer_types where slug = 'smb'`),
    );

    const stillThere = await rows<{ n: number }>(
      sql`select count(*)::int as n from customer_types where slug = 'smb'`,
    );
    expect(stillThere[0]?.n).toBe(1);
  });

  it('an admin can create an entry, and it is audited', async () => {
    const admin = await createUser({ platformRole: 'admin' });
    const slug = `admin-created-${Date.now().toString(36)}`;

    const created = await createTaxonomyEntry(await actorFor(admin.id), 'industries', {
      slug,
      name: 'Admin Created',
      parentSlug: 'software-technology',
    });

    expect(created.ok).toBe(true);

    const audit = await rows<{ n: number }>(sql`
      select count(*)::int as n from audit_logs
      where action = 'taxonomy.entry_created' and target_type = 'industries'
    `);
    expect(audit[0]?.n).toBeGreaterThan(0);

    await db.execute(sql`delete from industries where slug = ${slug}`);
  });
});

// ===========================================================================
// Retirement semantics
// ===========================================================================

describe('retiring an entry preserves history', () => {
  it('a retired entry disappears from pickers but still resolves for existing data', async () => {
    const admin = await createUser({ platformRole: 'admin' });
    const adminActor = await actorFor(admin.id);
    const slug = `retire-me-${Date.now().toString(36)}`;

    await createTaxonomyEntry(adminActor, 'industries', {
      slug,
      name: 'To Be Retired',
      parentSlug: 'software-technology',
    });

    const retired = await setTaxonomyEntryActive(adminActor, 'industries', slug, false);
    expect(retired.ok).toBe(true);

    const activeOnly = await listIndustries(ANONYMOUS, { activeOnly: true });
    const all = await listIndustries(ANONYMOUS);

    const flatten = (nodes: Array<{ slug: string; children: Array<unknown> }>): string[] =>
      nodes.flatMap((n) => [
        n.slug,
        ...flatten(n.children as Array<{ slug: string; children: Array<unknown> }>),
      ]);

    expect(activeOnly.ok && flatten(activeOnly.data)).not.toContain(slug);
    // Still readable, so a profile referencing it does not render a hole.
    expect(all.ok && flatten(all.data)).toContain(slug);

    await db.execute(sql`delete from industries where slug = ${slug}`);
  });
});

// ===========================================================================
// Ancestors helper
// ===========================================================================

describe('territory ancestors', () => {
  it('returns the full chain from root to the territory', async () => {
    const laId = await territoryIdBySlug('los-angeles-metro');
    const result = await getTerritoryAncestors(ANONYMOUS, laId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.map((t) => t.slug)).toEqual([
      'anywhere',
      'united-states',
      'us-west',
      'california',
      'los-angeles-metro',
    ]);
  });

  it('returns not-found for an id that does not exist', async () => {
    const result = await getTerritoryAncestors(
      ANONYMOUS,
      '01890000-0000-7000-8000-000000000000',
    );
    expect(result.ok).toBe(false);
  });
});
