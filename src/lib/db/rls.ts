import 'server-only';

import { sql } from 'drizzle-orm';

import { actorPlatformRole, actorUserId, type Actor } from '@/lib/auth/actor';

import { db } from './client';

/**
 * A transaction handle with the caller's identity applied.
 * Structurally a Drizzle transaction; the distinct name makes it obvious in
 * repository signatures that the handle is actor-scoped.
 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Run a unit of work with Row Level Security enforced against the given actor.
 *
 * Mechanism, in order, inside one transaction:
 *
 *   1. `app.user_id` and `app.platform_role` are set from the *verified*
 *      actor. RLS policies read these via app.current_user_id().
 *   2. `SET LOCAL ROLE app_user` downgrades from the owner role. app_user does
 *      not have BYPASSRLS, so every policy now applies — even though the query
 *      originates from our own server.
 *
 * Both settings are transaction-local, so they are discarded on commit or
 * rollback and cannot leak into the next request that reuses the connection.
 *
 * The role downgrade happens last, deliberately: once downgraded we want no
 * further privileged setup to be possible in this transaction.
 *
 * System actors skip the downgrade and therefore bypass RLS. That path exists
 * for cron jobs and webhooks, is confined to named entry points, and every use
 * must be audited by the caller.
 */
export async function withActor<T>(
  actor: Actor,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    if (actor.kind === 'system') {
      await tx.execute(
        sql`select set_config('app.actor_kind', 'system', true),
                   set_config('app.system_reason', ${actor.reason}, true)`,
      );
      return work(tx);
    }

    const userId = actorUserId(actor);

    await tx.execute(
      sql`select set_config('app.user_id', ${userId ?? ''}, true),
                 set_config('app.platform_role', ${actorPlatformRole(actor)}, true),
                 set_config('app.actor_kind', ${actor.kind}, true)`,
    );

    await tx.execute(sql`set local role app_user`);

    return work(tx);
  });
}

/**
 * Read back the request context the database currently sees.
 * Used by the RLS test suite to prove the context is applied and, crucially,
 * that it does not survive the transaction.
 */
export async function readRequestContext(tx: Tx): Promise<{
  userId: string | null;
  platformRole: string;
  role: string;
}> {
  const result = await tx.execute<{
    user_id: string | null;
    platform_role: string;
    role: string;
  }>(
    sql`select app.current_user_id()::text     as user_id,
               app.current_platform_role()      as platform_role,
               current_user::text               as role`,
  );

  const row = (result as unknown as Array<{
    user_id: string | null;
    platform_role: string;
    role: string;
  }>)[0];

  if (!row) throw new Error('Failed to read request context');

  return {
    userId: row.user_id,
    platformRole: row.platform_role,
    role: row.role,
  };
}
