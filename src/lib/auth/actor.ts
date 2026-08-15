import type { OrgRole, PlatformRole } from '@/lib/db/schema';

/**
 * Who is making a request.
 *
 * Every repository function takes an Actor as its first, mandatory argument.
 * There is deliberately no overload without one: a query that "forgot"
 * authorization is not a query this codebase can express.
 *
 * An Actor is only ever constructed from a verified session (or explicitly, by
 * a cron/webhook entry point). It is never built from user-supplied input —
 * accepting a userId from a form field would defeat the entire model.
 */
export type Actor =
  | AnonymousActor
  | UserActor
  | AdminActor
  | SystemActor;

export interface AnonymousActor {
  readonly kind: 'anonymous';
}

/** A signed-in user. Organisation membership is resolved per-request. */
export interface UserActor {
  readonly kind: 'user';
  readonly userId: string;
  readonly platformRole: Extract<PlatformRole, 'member'>;
  readonly memberships: readonly ActorMembership[];
  /** The user's rep profile, if they have created one. Null is normal. */
  readonly repProfileId: string | null;
}

export interface AdminActor {
  readonly kind: 'admin';
  readonly userId: string;
  readonly platformRole: Extract<PlatformRole, 'admin' | 'superadmin'>;
  readonly memberships: readonly ActorMembership[];
  readonly repProfileId: string | null;
  /** Set when this session is impersonating another user. Always audited. */
  readonly impersonatedBy?: string;
}

/**
 * Cron jobs and webhook handlers. Runs with RLS bypassed, so it is confined to
 * a small number of named entry points and every use is audited.
 */
export interface SystemActor {
  readonly kind: 'system';
  readonly reason: string;
}

export interface ActorMembership {
  readonly organizationId: string;
  readonly orgRole: OrgRole;
}

export const ANONYMOUS: AnonymousActor = { kind: 'anonymous' };

export function system(reason: string): SystemActor {
  return { kind: 'system', reason };
}

/** Actors that correspond to a real signed-in person. */
export type AuthenticatedActor = UserActor | AdminActor;

export function isAuthenticated(actor: Actor): actor is AuthenticatedActor {
  return actor.kind === 'user' || actor.kind === 'admin';
}

export function isAdmin(actor: Actor): actor is AdminActor {
  return actor.kind === 'admin';
}

export function isSuperadmin(actor: Actor): boolean {
  return actor.kind === 'admin' && actor.platformRole === 'superadmin';
}

/** The user id, or null for anonymous and system actors. */
export function actorUserId(actor: Actor): string | null {
  return isAuthenticated(actor) ? actor.userId : null;
}

/** The value written into the `app.platform_role` request setting. */
export function actorPlatformRole(actor: Actor): string {
  switch (actor.kind) {
    case 'user':
    case 'admin':
      return actor.platformRole;
    case 'system':
      return 'system';
    case 'anonymous':
      return 'anonymous';
  }
}

/** The caller's own rep profile id, or null for anyone without one. */
export function actorRepProfileId(actor: Actor): string | null {
  return isAuthenticated(actor) ? actor.repProfileId : null;
}

export function membershipIn(
  actor: Actor,
  organizationId: string,
): ActorMembership | null {
  if (!isAuthenticated(actor)) return null;
  return (
    actor.memberships.find((m) => m.organizationId === organizationId) ?? null
  );
}
