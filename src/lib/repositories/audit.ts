import 'server-only';

import { desc, eq } from 'drizzle-orm';

import { actorPlatformRole, isAdmin, type Actor } from '@/lib/auth/actor';
import { auditLogs } from '@/lib/db/schema';
import type { Tx } from '@/lib/db/rls';
import { withActor } from '@/lib/db/rls';
import { forbidden, type Result, ok, err } from '@/lib/errors';

export interface AuditEntry {
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Append an audit entry inside an existing transaction.
 *
 * Taking the transaction rather than opening its own is the point: the audit
 * row commits with the change it describes, or neither commits. An audit trail
 * that can disagree with reality is worse than none.
 */
export async function recordAudit(
  tx: Tx,
  actor: Actor,
  entry: AuditEntry,
): Promise<void> {
  const actorUserId =
    actor.kind === 'user' || actor.kind === 'admin' ? actor.userId : null;

  await tx.insert(auditLogs).values({
    actorUserId,
    actorRole: actorPlatformRole(actor),
    impersonatedBy:
      actor.kind === 'admin' ? (actor.impersonatedBy ?? null) : null,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    beforeState: entry.before ?? null,
    afterState: entry.after ?? null,
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
  });
}

export async function listAuditForTarget(
  actor: Actor,
  targetType: string,
  targetId: string,
  limit = 50,
): Promise<Result<(typeof auditLogs.$inferSelect)[]>> {
  if (!isAdmin(actor)) return err(forbidden());

  const rows = await withActor(actor, async (tx) =>
    tx
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.targetId, targetId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(Math.min(limit, 200)),
  );

  return ok(rows.filter((r) => r.targetType === targetType));
}
