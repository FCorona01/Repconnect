import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { ANONYMOUS, system } from '@/lib/auth/actor';
import { db } from '@/lib/db/client';
import { readRequestContext, withActor } from '@/lib/db/rls';

import { actorFor, closeDb, createOrganization, createUser } from './setup/fixtures';

afterAll(closeDb);

/**
 * Proves the mechanism itself, independently of any repository.
 *
 * If these fail, every authorization guarantee in the application is void —
 * regardless of how correct the application code looks.
 */
describe('RLS request context', () => {
  it('downgrades to the restricted role and applies the actor identity', async () => {
    const user = await createUser();
    const actor = await actorFor(user.id);

    const context = await withActor(actor, (tx) => readRequestContext(tx));

    expect(context.role).toBe('app_user');
    expect(context.userId).toBe(user.id);
    expect(context.platformRole).toBe('member');
  });

  it('leaves no identity behind for anonymous actors', async () => {
    const context = await withActor(ANONYMOUS, (tx) => readRequestContext(tx));

    expect(context.role).toBe('app_user');
    expect(context.userId).toBeNull();
    expect(context.platformRole).toBe('anonymous');
  });

  it('does not leak context into a later transaction on the same pool', async () => {
    const user = await createUser();
    const actor = await actorFor(user.id);

    await withActor(actor, (tx) => readRequestContext(tx));

    // A fresh transaction must not inherit the previous actor. If SET LOCAL
    // ever regressed to SET, this is the test that catches it — and the bug
    // would be one user seeing another's data under connection reuse.
    const after = await withActor(ANONYMOUS, (tx) => readRequestContext(tx));
    expect(after.userId).toBeNull();
  });

  it('keeps the owner role on the system path', async () => {
    const context = await withActor(system('test'), (tx) => readRequestContext(tx));
    expect(context.role).not.toBe('app_user');
  });

  it('the restricted role cannot bypass RLS', async () => {
    const result = await db.execute(
      sql`select rolbypassrls from pg_roles where rolname = 'app_user'`,
    );
    const rows = result as unknown as Array<{ rolbypassrls: boolean }>;
    expect(rows[0]?.rolbypassrls).toBe(false);
  });
});

describe('deny by default', () => {
  /**
   * The guardrail that keeps the codebase from decaying.
   *
   * Any table added in a future phase without RLS enabled fails this test, in
   * CI, before it can reach production carrying real user data.
   */
  it('every application table has RLS enabled and forced', async () => {
    const result = await db.execute(sql`
      select c.relname            as table_name,
             c.relrowsecurity     as rls_enabled,
             c.relforcerowsecurity as rls_forced
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relname <> 'schema_migrations'
      order by c.relname
    `);

    const tables = result as unknown as Array<{
      table_name: string;
      rls_enabled: boolean;
      rls_forced: boolean;
    }>;

    expect(tables.length).toBeGreaterThan(0);

    const unprotected = tables.filter((t) => !t.rls_enabled || !t.rls_forced);
    expect(
      unprotected.map((t) => t.table_name),
      'tables missing RLS — add policies in the same migration that creates the table',
    ).toEqual([]);
  });

  it('a table with no matching policy returns nothing rather than everything', async () => {
    const owner = await createUser();
    await createOrganization(owner.id);

    // Anonymous has no policy granting access to organization_members.
    const rows = await withActor(ANONYMOUS, async (tx) =>
      tx.execute(sql`select count(*)::int as n from organization_members`),
    );

    const result = rows as unknown as Array<{ n: number }>;
    expect(result[0]?.n).toBe(0);
  });

  it('audit_logs cannot be updated or deleted by the application role', async () => {
    const result = await db.execute(sql`
      select privilege_type
      from information_schema.role_table_grants
      where grantee = 'app_user' and table_name = 'audit_logs'
      order by privilege_type
    `);

    const granted = (result as unknown as Array<{ privilege_type: string }>).map(
      (r) => r.privilege_type,
    );

    expect(granted).toContain('SELECT');
    expect(granted).toContain('INSERT');
    expect(granted).not.toContain('UPDATE');
    expect(granted).not.toContain('DELETE');
  });
});

describe('SQL and TypeScript permission rules agree', () => {
  it('org_role_rank matches ORG_ROLE_RANK', async () => {
    const { ORG_ROLE_RANK } = await import('@/lib/db/schema');

    for (const [role, expected] of Object.entries(ORG_ROLE_RANK)) {
      const result = await db.execute(
        sql`select app.org_role_rank(${role}) as rank`,
      );
      const rows = result as unknown as Array<{ rank: number }>;
      expect(rows[0]?.rank, `rank mismatch for ${role}`).toBe(expected);
    }
  });
});
