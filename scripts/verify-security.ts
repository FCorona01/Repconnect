/**
 * Verifies the security invariants against whichever database it is pointed at.
 *
 * The test suite proves these locally. This proves them on the database that
 * actually holds user data — which is the one that matters, and the one nobody
 * can inspect from a laptop without credentials.
 *
 * Exits non-zero on any violation, so a deploy pipeline stops rather than
 * shipping a database with security disabled.
 */
import postgres from 'postgres';

interface Check {
  name: string;
  run: (sql: postgres.Sql) => Promise<{ pass: boolean; detail: string }>;
}

const checks: Check[] = [
  {
    name: 'every application table has RLS enabled and forced',
    run: async (sql) => {
      const rows = await sql<{ relname: string }[]>`
        select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and c.relname <> 'schema_migrations'
          and (not c.relrowsecurity or not c.relforcerowsecurity)
      `;
      return {
        pass: rows.length === 0,
        detail:
          rows.length === 0
            ? 'all tables protected'
            : `unprotected: ${rows.map((r) => r.relname).join(', ')}`,
      };
    },
  },
  {
    name: 'the app_user role exists and cannot bypass RLS',
    run: async (sql) => {
      const rows = await sql<{ rolbypassrls: boolean }[]>`
        select rolbypassrls from pg_roles where rolname = 'app_user'
      `;
      const role = rows[0];
      return {
        pass: role !== undefined && role.rolbypassrls === false,
        detail:
          role === undefined
            ? 'app_user role is MISSING — RLS would not be enforced'
            : `rolbypassrls=${role.rolbypassrls}`,
      };
    },
  },
  {
    name: 'audit_logs is append-only for the application role',
    run: async (sql) => {
      const rows = await sql<{ privilege_type: string }[]>`
        select privilege_type
        from information_schema.role_table_grants
        where grantee = 'app_user' and table_name = 'audit_logs'
      `;
      const granted = rows.map((r) => r.privilege_type);
      const mutable = granted.filter((p) => p === 'UPDATE' || p === 'DELETE');
      return {
        pass: mutable.length === 0 && granted.includes('INSERT'),
        detail:
          mutable.length > 0
            ? `audit log is MUTABLE (${mutable.join(', ')} granted)`
            : `grants: ${granted.sort().join(', ')}`,
      };
    },
  },
  {
    name: 'every table has at least one RLS policy',
    run: async (sql) => {
      const rows = await sql<{ relname: string }[]>`
        select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_policy p on p.polrelid = c.oid
        where n.nspname = 'public'
          and c.relkind = 'r'
          and c.relname <> 'schema_migrations'
        group by c.relname
        having count(p.oid) = 0
      `;
      return {
        pass: rows.length === 0,
        detail:
          rows.length === 0
            ? 'all tables have policies'
            : `no policies (deny-all, likely unintended): ${rows
                .map((r) => r.relname)
                .join(', ')}`,
      };
    },
  },
  {
    name: 'the request-context functions exist',
    run: async (sql) => {
      const rows = await sql<{ proname: string }[]>`
        select p.proname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app'
          and p.proname in ('current_user_id', 'is_admin', 'is_org_member', 'uuid_generate_v7')
      `;
      const found = new Set(rows.map((r) => r.proname));
      const required = [
        'current_user_id',
        'is_admin',
        'is_org_member',
        'uuid_generate_v7',
      ];
      const missing = required.filter((r) => !found.has(r));
      return {
        pass: missing.length === 0,
        detail:
          missing.length === 0 ? 'all present' : `missing: ${missing.join(', ')}`,
      };
    },
  },
];

async function main(): Promise<void> {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('DIRECT_DATABASE_URL or DATABASE_URL must be set.');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  let failed = 0;

  try {
    console.log('Verifying security invariants\n');
    for (const check of checks) {
      const { pass, detail } = await check.run(sql);
      console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${check.name}`);
      console.log(`        ${detail}`);
      if (!pass) failed += 1;
    }
  } finally {
    await sql.end();
  }

  console.log('');
  if (failed > 0) {
    console.error(`${failed} security check(s) FAILED. Do not ship this database.`);
    process.exit(1);
  }
  console.log('All security invariants hold.');
}

main().catch((error: unknown) => {
  console.error('Verification failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
