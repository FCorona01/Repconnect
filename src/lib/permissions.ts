import {
  isAdmin,
  isAuthenticated,
  membershipIn,
  type Actor,
} from '@/lib/auth/actor';
import { ORG_ROLE_RANK, type OrgRole } from '@/lib/db/schema';

/**
 * Application-layer permission predicates.
 *
 * These mirror the SQL policies in supabase/migrations. Both walls are
 * deliberately load-bearing: the database enforces the same rules, so a bug
 * here is caught there and vice versa. The integration tests assert the two
 * agree.
 *
 * These are for *deciding* (what to render, what to allow). They are never the
 * only thing standing between a user and data — repository queries scope by
 * ownership regardless.
 */

export function canActInOrg(
  actor: Actor,
  organizationId: string,
  minRole: OrgRole = 'viewer',
): boolean {
  if (isAdmin(actor)) return true;
  const membership = membershipIn(actor, organizationId);
  if (!membership) return false;
  return ORG_ROLE_RANK[membership.orgRole] >= ORG_ROLE_RANK[minRole];
}

export function canManageOrgMembers(
  actor: Actor,
  organizationId: string,
): boolean {
  return canActInOrg(actor, organizationId, 'admin');
}

export function canEditOrgProfile(
  actor: Actor,
  organizationId: string,
): boolean {
  return canActInOrg(actor, organizationId, 'admin');
}

/** Opportunities arrive in Phase 3; recruiters may manage them. */
export function canManageOpportunities(
  actor: Actor,
  organizationId: string,
): boolean {
  return canActInOrg(actor, organizationId, 'recruiter');
}

export function canEditUser(actor: Actor, targetUserId: string): boolean {
  if (isAdmin(actor)) return true;
  return isAuthenticated(actor) && actor.userId === targetUserId;
}

export function canViewAuditLog(actor: Actor): boolean {
  return isAdmin(actor);
}

/**
 * Only a superadmin may change platform roles, and never their own — a lone
 * compromised admin account cannot mint more admins, and nobody can
 * accidentally demote the last superadmin.
 */
export function canChangePlatformRole(
  actor: Actor,
  targetUserId: string,
): boolean {
  return (
    isAdmin(actor) &&
    actor.platformRole === 'superadmin' &&
    actor.userId !== targetUserId
  );
}
