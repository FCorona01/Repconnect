import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db/client';
import { isSupabaseConfigured } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Health check.
 *
 * Checks the dependencies the app actually needs, not just "the web server
 * responded" — which is the useless version of a health check, because a
 * process with a dead database still answers it.
 */
export async function GET() {
  const checks: Record<string, 'ok' | 'fail' | 'not_configured'> = {
    server: 'ok',
    database: 'fail',
    rls: 'fail',
    auth: isSupabaseConfigured() ? 'ok' : 'not_configured',
  };

  try {
    await db.execute(sql`select 1`);
    checks.database = 'ok';

    // Confirms the security machinery is present, not merely that Postgres is
    // reachable: a database missing the app_user role would serve every query
    // with RLS bypassed.
    const result = await db.execute(
      sql`select count(*)::int as n from pg_roles where rolname = 'app_user' and not rolbypassrls`,
    );
    const rows = result as unknown as Array<{ n: number }>;
    checks.rls = rows[0]?.n === 1 ? 'ok' : 'fail';
  } catch {
    // Deliberately no error detail in the response: database errors leak schema
    // information. The exception is reported to Sentry from Phase 8.
  }

  const healthy = Object.values(checks).every((v) => v !== 'fail');

  return NextResponse.json(
    { status: healthy ? 'healthy' : 'degraded', checks },
    { status: healthy ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
