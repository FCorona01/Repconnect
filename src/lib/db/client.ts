import 'server-only';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

declare global {
  var __repconnectSql: ReturnType<typeof postgres> | undefined;
}

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.',
    );
  }
  return url;
}

/**
 * `prepare: false` is required when connecting through Supabase's transaction
 * pooler (Supavisor on port 6543): a pooled connection is not guaranteed to be
 * the same backend between statements, so server-side prepared statements
 * cannot be relied on.
 *
 * The client is cached on globalThis so Next.js hot reloads in development do
 * not open a new pool on every edit.
 */
function createSql(): ReturnType<typeof postgres> {
  return postgres(connectionString(), {
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => {},
  });
}

export const sqlClient: ReturnType<typeof postgres> =
  globalThis.__repconnectSql ?? createSql();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__repconnectSql = sqlClient;
}

/**
 * The raw Drizzle handle.
 *
 * Do NOT import this to run user-originated queries — it connects as the
 * database owner, which bypasses Row Level Security. Use withActor() from
 * ./rls instead, which downgrades the role for the transaction.
 *
 * This export exists for migrations, tests, and the audited system path.
 */
export const db = drizzle(sqlClient, { schema });

export type Database = typeof db;
