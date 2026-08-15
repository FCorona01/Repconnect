/**
 * Test environment defaults.
 *
 * Tests run against the local PostgreSQL from `pnpm db:up` — a real database
 * with real Row Level Security, never a mock. Authorization that is only
 * proven against a fake is not proven.
 */
// NODE_ENV is set to 'test' by Vitest itself, so it is not set here.
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@127.0.0.1:54322/repconnect';
process.env.DIRECT_DATABASE_URL ??= process.env.DATABASE_URL;
