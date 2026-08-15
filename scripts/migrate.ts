/**
 * Migration runner.
 *
 * Applies every .sql file in supabase/migrations in filename order, exactly
 * once, inside a transaction, recording each in schema_migrations.
 *
 * Deliberately not using drizzle-kit's generated migrations: RLS policies,
 * database roles, grants, and SECURITY DEFINER functions are not expressible
 * in an ORM schema DSL, and those are the parts that carry our security
 * guarantees. The SQL files are the source of truth for DDL; the Drizzle
 * schema in src/lib/db/schema is the typed query surface over it.
 *
 * Uses DIRECT_DATABASE_URL — migrations need a session-level connection and
 * cannot run through a transaction pooler.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import postgres from 'postgres';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

async function main(): Promise<void> {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('DIRECT_DATABASE_URL (or DATABASE_URL) must be set.');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    await sql`
      create table if not exists schema_migrations (
        filename    text primary key,
        checksum    text not null,
        applied_at  timestamptz not null default now()
      )
    `;

    const applied = await sql<{ filename: string; checksum: string }[]>`
      select filename, checksum from schema_migrations
    `;
    const appliedByName = new Map(applied.map((r) => [r.filename, r.checksum]));

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let ran = 0;

    for (const filename of files) {
      const body = await readFile(join(MIGRATIONS_DIR, filename), 'utf8');
      const checksum = createHash('sha256').update(body).digest('hex');
      const previous = appliedByName.get(filename);

      if (previous !== undefined) {
        // An already-applied migration that has since been edited means the
        // database and the repository disagree about the schema. Fail loudly:
        // silently ignoring it is how environments drift apart.
        if (previous !== checksum) {
          throw new Error(
            `Migration ${filename} was modified after being applied.\n` +
              'Applied migrations are immutable — add a new migration instead.',
          );
        }
        continue;
      }

      process.stdout.write(`  applying ${filename} ... `);
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`
          insert into schema_migrations (filename, checksum)
          values (${filename}, ${checksum})
        `;
      });
      process.stdout.write('ok\n');
      ran += 1;
    }

    console.log(
      ran === 0
        ? `Database up to date (${files.length} migrations already applied).`
        : `Applied ${ran} migration(s).`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error('\nMigration failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
