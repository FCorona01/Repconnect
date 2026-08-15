import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { isAdmin, isAuthenticated, type Actor } from '@/lib/auth/actor';
import { withActor } from '@/lib/db/rls';
import {
  organizationMembers,
  organizations,
  users,
  type Organization,
  type OrgRole,
} from '@/lib/db/schema';
import {
  canActInOrg,
  canEditOrgProfile,
  canManageOrgMembers,
} from '@/lib/permissions';
import { conflict, err, forbidden, notFound, ok, type Result } from '@/lib/errors';

import { recordAudit } from './audit';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(64)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    'Use lowercase letters, numbers and hyphens only.',
  );

export const createOrganizationSchema = z
  .object({
    slug: slugSchema,
    legalName: z.string().trim().min(1, 'Legal name is required').max(200),
    displayName: z.string().trim().min(1, 'Display name is required').max(120),
    website: z.url('Enter a valid URL').max(500).optional().or(z.literal('')),
    description: z.string().trim().max(5000).optional(),
  })
  .strict();

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = createOrganizationSchema
  .omit({ slug: true })
  .partial()
  .strict();

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

function validationError(error: z.ZodError): ReturnType<typeof err> {
  return err({
    code: 'validation' as const,
    message: 'Please check the highlighted fields.',
    fields: Object.fromEntries(
      error.issues.map((i) => [String(i.path[0] ?? '_'), i.message]),
    ),
  });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface OrganizationSummary {
  id: string;
  slug: string;
  displayName: string;
  website: string | null;
  description: string | null;
  verificationStatus: Organization['verificationStatus'];
}

export interface OrganizationMemberView {
  userId: string;
  fullName: string;
  email: string;
  orgRole: OrgRole;
  acceptedAt: Date | null;
  invitedAt: Date;
}

function toSummary(row: Organization): OrganizationSummary {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    website: row.website,
    description: row.description,
    verificationStatus: row.verificationStatus,
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Creates the organisation and its owner membership in one transaction.
 *
 * These must be atomic: an organisation with no owner is unreachable and
 * unadministrable — nobody could ever edit it or add a member.
 */
export async function createOrganization(
  actor: Actor,
  input: CreateOrganizationInput,
): Promise<Result<OrganizationSummary>> {
  if (!isAuthenticated(actor)) return err(forbidden());

  const parsed = createOrganizationSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);

  return withActor(actor, async (tx) => {
    const [existing] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(sql`lower(${organizations.slug}) = ${parsed.data.slug}`)
      .limit(1);

    if (existing) {
      return err(conflict('That URL name is already taken.'));
    }

    const [created] = await tx
      .insert(organizations)
      .values({
        slug: parsed.data.slug,
        legalName: parsed.data.legalName,
        displayName: parsed.data.displayName,
        website: parsed.data.website || null,
        description: parsed.data.description ?? null,
        createdBy: actor.userId,
      })
      .returning();

    if (!created) return err(conflict('Could not create the organisation.'));

    await tx.insert(organizationMembers).values({
      organizationId: created.id,
      userId: actor.userId,
      orgRole: 'owner',
      invitedBy: actor.userId,
      acceptedAt: new Date(),
    });

    await recordAudit(tx, actor, {
      action: 'organization.created',
      targetType: 'organization',
      targetId: created.id,
      after: { slug: created.slug, displayName: created.displayName },
    });

    return ok(toSummary(created));
  });
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getOrganizationBySlug(
  actor: Actor,
  slug: string,
): Promise<Result<OrganizationSummary>> {
  const rows = await withActor(actor, async (tx) =>
    tx
      .select()
      .from(organizations)
      .where(sql`lower(${organizations.slug}) = ${slug.trim().toLowerCase()}`)
      .limit(1),
  );

  const row = rows[0];
  return row ? ok(toSummary(row)) : err(notFound());
}

export async function getOrganizationById(
  actor: Actor,
  id: string,
): Promise<Result<OrganizationSummary>> {
  const rows = await withActor(actor, async (tx) =>
    tx.select().from(organizations).where(eq(organizations.id, id)).limit(1),
  );

  const row = rows[0];
  return row ? ok(toSummary(row)) : err(notFound());
}

/** Organisations the caller belongs to. */
export async function listMyOrganizations(
  actor: Actor,
): Promise<Result<Array<OrganizationSummary & { orgRole: OrgRole }>>> {
  if (!isAuthenticated(actor)) return err(forbidden());

  const rows = await withActor(actor, async (tx) =>
    tx
      .select({ org: organizations, orgRole: organizationMembers.orgRole })
      .from(organizationMembers)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationMembers.organizationId),
      )
      .where(
        and(
          eq(organizationMembers.userId, actor.userId),
          sql`${organizationMembers.acceptedAt} is not null`,
        ),
      ),
  );

  return ok(rows.map((r) => ({ ...toSummary(r.org), orgRole: r.orgRole })));
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateOrganization(
  actor: Actor,
  organizationId: string,
  input: UpdateOrganizationInput,
): Promise<Result<OrganizationSummary>> {
  if (!canEditOrgProfile(actor, organizationId)) return err(forbidden());

  const parsed = updateOrganizationSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);

  return withActor(actor, async (tx) => {
    const [before] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    const [updated] = await tx
      .update(organizations)
      .set({
        ...(parsed.data.legalName !== undefined
          ? { legalName: parsed.data.legalName }
          : {}),
        ...(parsed.data.displayName !== undefined
          ? { displayName: parsed.data.displayName }
          : {}),
        ...(parsed.data.website !== undefined
          ? { website: parsed.data.website || null }
          : {}),
        ...(parsed.data.description !== undefined
          ? { description: parsed.data.description }
          : {}),
      })
      .where(eq(organizations.id, organizationId))
      .returning();

    if (!updated) return err(notFound());

    await recordAudit(tx, actor, {
      action: 'organization.updated',
      targetType: 'organization',
      targetId: organizationId,
      before: before
        ? { displayName: before.displayName, website: before.website }
        : null,
      after: { displayName: updated.displayName, website: updated.website },
    });

    return ok(toSummary(updated));
  });
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

export async function listMembers(
  actor: Actor,
  organizationId: string,
): Promise<Result<OrganizationMemberView[]>> {
  // Organisations are publicly readable — businesses want to be found — but
  // their team is not. Without this check a non-member would receive an empty
  // list, which is both a wrong answer and a misleading one: it asserts the
  // organisation has no team. Membership is read from the already-resolved
  // actor, so this costs no round trip and has no race window.
  if (!canActInOrg(actor, organizationId)) return err(notFound());

  const rows = await withActor(actor, async (tx) =>
    tx
      .select({
        userId: organizationMembers.userId,
        orgRole: organizationMembers.orgRole,
        acceptedAt: organizationMembers.acceptedAt,
        invitedAt: organizationMembers.invitedAt,
        fullName: users.fullName,
        email: users.email,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, organizationId)),
  );

  return ok(rows);
}

export const addMemberSchema = z
  .object({
    email: z.email('Enter a valid email address').transform((e) => e.toLowerCase()),
    orgRole: z.enum(['admin', 'recruiter', 'viewer']),
  })
  .strict();

export type AddMemberInput = z.infer<typeof addMemberSchema>;

/**
 * Invites an existing user to an organisation.
 *
 * `owner` is deliberately not assignable here — ownership transfer is a
 * separate, deliberate operation, and the database enforces one owner per
 * organisation with a partial unique index regardless.
 */
export async function addMember(
  actor: Actor,
  organizationId: string,
  input: AddMemberInput,
): Promise<Result<{ userId: string; orgRole: OrgRole }>> {
  if (!canManageOrgMembers(actor, organizationId)) return err(forbidden());

  const parsed = addMemberSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);

  return withActor(actor, async (tx) => {
    const [target] = await tx
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${parsed.data.email}`)
      .limit(1);

    if (!target) {
      return err(notFound('No account exists with that email address.'));
    }

    const [existing] = await tx
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, target.id),
        ),
      )
      .limit(1);

    if (existing) return err(conflict('That person is already on this team.'));

    const [created] = await tx
      .insert(organizationMembers)
      .values({
        organizationId,
        userId: target.id,
        orgRole: parsed.data.orgRole,
        invitedBy: isAuthenticated(actor) ? actor.userId : null,
      })
      .returning();

    if (!created) return err(conflict('Could not add that person.'));

    await recordAudit(tx, actor, {
      action: 'organization.member_invited',
      targetType: 'organization',
      targetId: organizationId,
      after: { userId: target.id, orgRole: parsed.data.orgRole },
    });

    return ok({ userId: created.userId, orgRole: created.orgRole });
  });
}

/** Accepts an invitation. Only the invited user can do this, never an admin. */
export async function acceptInvitation(
  actor: Actor,
  organizationId: string,
): Promise<Result<{ organizationId: string }>> {
  if (!isAuthenticated(actor)) return err(forbidden());

  return withActor(actor, async (tx) => {
    const [updated] = await tx
      .update(organizationMembers)
      .set({ acceptedAt: new Date() })
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, actor.userId),
          sql`${organizationMembers.acceptedAt} is null`,
        ),
      )
      .returning();

    if (!updated) return err(notFound('No pending invitation found.'));

    await recordAudit(tx, actor, {
      action: 'organization.invitation_accepted',
      targetType: 'organization',
      targetId: organizationId,
      after: { userId: actor.userId },
    });

    return ok({ organizationId });
  });
}

export async function removeMember(
  actor: Actor,
  organizationId: string,
  targetUserId: string,
): Promise<Result<{ removed: true }>> {
  const isSelf = isAuthenticated(actor) && actor.userId === targetUserId;
  if (!isSelf && !canManageOrgMembers(actor, organizationId)) {
    return err(forbidden());
  }

  return withActor(actor, async (tx) => {
    const [member] = await tx
      .select({ orgRole: organizationMembers.orgRole })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, targetUserId),
        ),
      )
      .limit(1);

    if (!member) return err(notFound());

    // Removing the owner would orphan the organisation. Ownership must be
    // transferred first.
    if (member.orgRole === 'owner') {
      return err(
        conflict('Transfer ownership before removing the owner from the team.'),
      );
    }

    const deleted = await tx
      .delete(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, targetUserId),
        ),
      )
      .returning({ id: organizationMembers.id });

    if (deleted.length === 0) return err(notFound());

    await recordAudit(tx, actor, {
      action: 'organization.member_removed',
      targetType: 'organization',
      targetId: organizationId,
      before: { userId: targetUserId, orgRole: member.orgRole },
    });

    return ok({ removed: true as const });
  });
}

/**
 * Organisations visible to an admin. Separate function rather than a branch
 * inside a user-facing one, so admin-scoped reads are greppable and cannot be
 * reached by autocomplete from a member page.
 */
export async function adminListOrganizations(
  actor: Actor,
  ids?: string[],
): Promise<Result<OrganizationSummary[]>> {
  if (!isAdmin(actor)) return err(forbidden());

  const rows = await withActor(actor, async (tx) =>
    ids && ids.length > 0
      ? tx.select().from(organizations).where(inArray(organizations.id, ids))
      : tx.select().from(organizations).limit(200),
  );

  return ok(rows.map(toSummary));
}
