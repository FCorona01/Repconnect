import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  isAuthenticated,
  system,
  type Actor,
  type ActorMembership,
  type AdminActor,
  type UserActor,
} from '@/lib/auth/actor';
import { db } from '@/lib/db/client';
import { withActor } from '@/lib/db/rls';
import { organizationMembers, repProfiles, users, type User } from '@/lib/db/schema';
import { canChangePlatformRole, canEditUser } from '@/lib/permissions';
import { conflict, err, forbidden, notFound, ok, type Result } from '@/lib/errors';

import { recordAudit } from './audit';

// ---------------------------------------------------------------------------
// Views
//
// Authorization is not only about rows. Different callers get different
// *shapes*, so a public page cannot render a private field even by mistake.
// ---------------------------------------------------------------------------

export interface UserPublicView {
  id: string;
  fullName: string;
}

export interface UserSelfView extends UserPublicView {
  email: string;
  platformRole: User['platformRole'];
  status: User['status'];
  emailVerifiedAt: Date | null;
  mfaEnabled: boolean;
  createdAt: Date;
}

function toPublicView(row: User): UserPublicView {
  return { id: row.id, fullName: row.fullName };
}

function toSelfView(row: User): UserSelfView {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    platformRole: row.platformRole,
    status: row.status,
    emailVerifiedAt: row.emailVerifiedAt,
    mfaEnabled: row.mfaEnabled,
    createdAt: row.createdAt,
  };
}

export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();

// ---------------------------------------------------------------------------
// Provisioning
//
// Runs on the system path because it creates the very record the actor model
// depends on. Deliberately NOT a database trigger on auth.users: keeping it in
// application code means it is testable without Supabase, and the domain model
// does not hard-depend on one auth vendor's schema.
// ---------------------------------------------------------------------------

export interface ProvisionInput {
  authUserId: string;
  email: string;
  fullName: string;
  emailVerified: boolean;
}

export async function provisionUserFromAuth(
  input: ProvisionInput,
): Promise<Result<User>> {
  const email = normalizeEmail(input.email);

  return withActor(system('auth:provision'), async (tx) => {
    const [existingByAuthId] = await tx
      .select()
      .from(users)
      .where(eq(users.authUserId, input.authUserId))
      .limit(1);

    if (existingByAuthId) {
      // Keep verification state in step with the auth provider.
      if (input.emailVerified && !existingByAuthId.emailVerifiedAt) {
        const [updated] = await tx
          .update(users)
          .set({
            emailVerifiedAt: new Date(),
            status:
              existingByAuthId.status === 'pending_verification'
                ? 'active'
                : existingByAuthId.status,
          })
          .where(eq(users.id, existingByAuthId.id))
          .returning();
        return ok(updated ?? existingByAuthId);
      }
      return ok(existingByAuthId);
    }

    const [existingByEmail] = await tx
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);

    if (existingByEmail) {
      if (existingByEmail.authUserId && existingByEmail.authUserId !== input.authUserId) {
        return err(conflict('That email is already linked to another account.'));
      }
      const [linked] = await tx
        .update(users)
        .set({ authUserId: input.authUserId })
        .where(eq(users.id, existingByEmail.id))
        .returning();
      return ok(linked ?? existingByEmail);
    }

    const [created] = await tx
      .insert(users)
      .values({
        authUserId: input.authUserId,
        email,
        fullName: input.fullName.trim(),
        // platform_role is NOT settable here. New users are always members.
        platformRole: 'member',
        status: input.emailVerified ? 'active' : 'pending_verification',
        emailVerifiedAt: input.emailVerified ? new Date() : null,
      })
      .returning();

    if (!created) return err(conflict('Could not create the account.'));

    await recordAudit(tx, system('auth:provision'), {
      action: 'user.provisioned',
      targetType: 'user',
      targetId: created.id,
      after: { email: created.email, status: created.status },
    });

    return ok(created);
  });
}

// ---------------------------------------------------------------------------
// Actor construction
//
// The only place an Actor is built from a session. Runs on the system path
// because it must read the user row *in order to decide* what the caller may
// see — a chicken-and-egg the RLS path cannot resolve for itself.
// ---------------------------------------------------------------------------

export async function buildActorForAuthUser(
  authUserId: string,
): Promise<Actor | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.authUserId, authUserId), isNull(users.deletedAt)))
    .limit(1);

  if (!row) return null;

  // Suspended and deactivated accounts are refused here, so an existing
  // session dies on the next request rather than surviving until token expiry.
  if (row.status === 'suspended' || row.status === 'deactivated') return null;

  const memberRows = await db
    .select({
      organizationId: organizationMembers.organizationId,
      orgRole: organizationMembers.orgRole,
    })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.userId, row.id),
        sql`${organizationMembers.acceptedAt} is not null`,
      ),
    );

  const memberships: ActorMembership[] = memberRows.map((m) => ({
    organizationId: m.organizationId,
    orgRole: m.orgRole,
  }));

  const [profile] = await db
    .select({ id: repProfiles.id })
    .from(repProfiles)
    .where(eq(repProfiles.userId, row.id))
    .limit(1);

  const repProfileId = profile?.id ?? null;

  if (row.platformRole === 'admin' || row.platformRole === 'superadmin') {
    const admin: AdminActor = {
      kind: 'admin',
      userId: row.id,
      platformRole: row.platformRole,
      memberships,
      repProfileId,
    };
    return admin;
  }

  const user: UserActor = {
    kind: 'user',
    userId: row.id,
    platformRole: 'member',
    memberships,
    repProfileId,
  };
  return user;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getSelf(actor: Actor): Promise<Result<UserSelfView>> {
  if (!isAuthenticated(actor)) return err(forbidden());

  const rows = await withActor(actor, async (tx) =>
    tx.select().from(users).where(eq(users.id, actor.userId)).limit(1),
  );

  const row = rows[0];
  return row ? ok(toSelfView(row)) : err(notFound());
}

/**
 * Reads another user. RLS decides what is visible — this returns not-found for
 * anything the caller may not see, rather than distinguishing "hidden" from
 * "absent".
 */
export async function getUserById(
  actor: Actor,
  userId: string,
): Promise<Result<UserPublicView>> {
  const rows = await withActor(actor, async (tx) =>
    tx.select().from(users).where(eq(users.id, userId)).limit(1),
  );

  const row = rows[0];
  return row ? ok(toPublicView(row)) : err(notFound());
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Explicit allowlist. RLS controls which *rows* a caller may update; it cannot
 * control which columns. Mass-assignment protection therefore lives here — and
 * .strict() rejects unknown keys outright, so submitting
 * `platformRole: "admin"` in a profile form fails validation.
 */
export const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(1, 'Name is required').max(120),
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export async function updateProfile(
  actor: Actor,
  targetUserId: string,
  input: UpdateProfileInput,
): Promise<Result<UserSelfView>> {
  if (!canEditUser(actor, targetUserId)) return err(forbidden());

  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) {
    return err({
      code: 'validation',
      message: 'Please check the highlighted fields.',
      fields: Object.fromEntries(
        parsed.error.issues.map((i) => [String(i.path[0] ?? '_'), i.message]),
      ),
    });
  }

  return withActor(actor, async (tx) => {
    const [before] = await tx
      .select()
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    // Zero rows means RLS refused the update. We do not distinguish that from
    // "no such user".
    const [updated] = await tx
      .update(users)
      .set({ fullName: parsed.data.fullName })
      .where(eq(users.id, targetUserId))
      .returning();

    if (!updated) return err(notFound());

    await recordAudit(tx, actor, {
      action: 'user.profile_updated',
      targetType: 'user',
      targetId: targetUserId,
      before: before ? { fullName: before.fullName } : null,
      after: { fullName: updated.fullName },
    });

    return ok(toSelfView(updated));
  });
}

/**
 * Platform role changes. Superadmin only, never on oneself, always audited.
 * There is no other code path that writes platform_role.
 */
export async function setPlatformRole(
  actor: Actor,
  targetUserId: string,
  role: User['platformRole'],
): Promise<Result<UserSelfView>> {
  if (!canChangePlatformRole(actor, targetUserId)) return err(forbidden());

  return withActor(actor, async (tx) => {
    const [before] = await tx
      .select()
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (!before) return err(notFound());

    const [updated] = await tx
      .update(users)
      .set({ platformRole: role })
      .where(eq(users.id, targetUserId))
      .returning();

    if (!updated) return err(notFound());

    await recordAudit(tx, actor, {
      action: 'user.platform_role_changed',
      targetType: 'user',
      targetId: targetUserId,
      before: { platformRole: before.platformRole },
      after: { platformRole: updated.platformRole },
    });

    return ok(toSelfView(updated));
  });
}
