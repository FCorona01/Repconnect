import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit is used for `db:studio` and for diffing the schema against the
 * database. It is NOT used to generate migrations: RLS policies, roles, grants
 * and SECURITY DEFINER functions cannot be expressed in the schema DSL, and
 * those carry our security guarantees.
 *
 * supabase/migrations/*.sql is the source of truth for DDL.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/lib/db/schema/index.ts',
  out: './drizzle/_generated',
  dbCredentials: {
    url:
      process.env.DIRECT_DATABASE_URL ??
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:54322/repconnect',
  },
  verbose: true,
  strict: true,
});
