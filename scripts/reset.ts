/**
 * Drops and rebuilds the local database from migrations.
 *
 * Refuses to run against anything that is not obviously a local database, so
 * a stray DATABASE_URL cannot destroy a real environment.
 */
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

async function main(): Promise<void> {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL must be set.');
    process.exit(1);
  }

  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.includes(host)) {
    console.error(
      `Refusing to reset a non-local database (host: ${host}).\n` +
        'This command drops every table. It only ever runs against localhost.',
    );
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    console.log('Dropping schemas...');
    await sql.unsafe(`
      drop schema if exists public cascade;
      drop schema if exists app cascade;
      create schema public;
      grant all on schema public to postgres;
    `);
    console.log('Schemas dropped.');
  } finally {
    await sql.end();
  }

  const result = spawnSync('node', ['--import', 'tsx', 'scripts/migrate.ts'], {
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(result.status ?? 0);
}

main().catch((error: unknown) => {
  console.error('Reset failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
