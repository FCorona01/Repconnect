import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { isAdmin, isAuthenticated, type Actor } from '@/lib/auth/actor';
import type { Tx } from '@/lib/db/rls';
import { withActor } from '@/lib/db/rls';
import {
  industries,
  orgIndustries,
  orgProductCategories,
  organizationMembers,
  organizations,
  productCategories,
  territories,
  users,
  type Organization,
  type OrgRole,
  type OrgSizeBand,
} from '@/lib/db/schema';
import {
  canActInOrg,
  canEditOrgProfile,
  canManageOrgMembers,
} from '@/lib/permissions';
import { ORG_ROLE_RANK } from '@/lib/db/schema';
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

const SIZE_BANDS = ['1-10', '11-50', '51-200', '201-1000', '1000+'] as const;

const attributeRefSchema = z.object({ slug: z.string().trim().min(2).max(80) });

export const updateOrganizationSchema = createOrganizationSchema
  .omit({ slug: true })
  .partial()
  .extend({
    tagline: z.string().trim().max(200).nullable().optional(),
    sizeBand: z.enum(SIZE_BANDS).nullable().optional(),
    // The database constraint is a wide fixed range (CHECK must be IMMUTABLE,
    // so it cannot reference the current year). This is the check that matters.
    foundedYear: z
      .number()
      .int()
      .min(1600)
      .max(new Date().getUTCFullYear() + 1, 'That year is in the future.')
      .nullable()
      .optional(),
    hqTerritorySlug: z.string().trim().min(2).max(80).nullable().optional(),
    industries: z.array(attributeRefSchema).max(20).optional(),
    productCategories: z.array(attributeRefSchema).max(20).optional(),
  })
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

export interface OrgAttribute {
  id: string;
  slug: string;
  name: string;
}

/**
 * The company as the world sees it.
 *
 * `legalName` is deliberately absent: it is needed for verification and
 * contracts, not for a public directory listing, and publishing it invites
 * confusion with the trading name people actually recognise.
 */
export interface OrganizationProfileView extends OrganizationSummary {
  tagline: string | null;
  sizeBand: OrgSizeBand | null;
  foundedYear: number | null;
  logoFileId: string | null;
  headquarters: { slug: string; name: string; ancestors: string[] } | null;
  industries: OrgAttribute[];
  productCategories: OrgAttribute[];
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

/** Attribute rows for an organisation. Visibility is decided by RLS. */
async function loadOrgAttributes(
  tx: Tx,
  organizationId: string,
): Promise<{ industries: OrgAttribute[]; productCategories: OrgAttribute[] }> {
  const [ind, cat] = await Promise.all([
    tx
      .select({ id: industries.id, slug: industries.slug, name: industries.name })
      .from(orgIndustries)
      .innerJoin(industries, eq(industries.id, orgIndustries.industryId))
      .where(eq(orgIndustries.organizationId, organizationId)),
    tx
      .select({
        id: productCategories.id,
        slug: productCategories.slug,
        name: productCategories.name,
      })
      .from(orgProductCategories)
      .innerJoin(
        productCategories,
        eq(productCategories.id, orgProductCategories.productCategoryId),
      )
      .where(eq(orgProductCategories.organizationId, organizationId)),
  ]);

  return { industries: ind, productCategories: cat };
}

async function loadHeadquarters(
  tx: Tx,
  territoryId: string | null,
): Promise<OrganizationProfileView['headquarters']> {
  if (!territoryId) return null;

  // Ancestors come back in the same query via the ltree path, so rendering
  // "California › Los Angeles Metro" costs no extra round trip.
  const result = await tx.execute<{
    slug: string;
    name: string;
    ancestors: string[] | null;
  }>(sql`
    select t.slug, t.name,
           (
             select array_agg(a.name order by nlevel(a.path))
             from territories a
             where a.path @> t.path and a.id <> t.id
           ) as ancestors
    from territories t
    where t.id = ${territoryId}
  `);

  const row = (result as unknown as Array<{
    slug: string;
    name: string;
    ancestors: string[] | null;
  }>)[0];

  return row ? { slug: row.slug, name: row.name, ancestors: row.ancestors ?? [] } : null;
}

async function toProfileView(tx: Tx, row: Organization): Promise<OrganizationProfileView> {
  const [attributes, headquarters] = await Promise.all([
    loadOrgAttributes(tx, row.id),
    loadHeadquarters(tx, row.hqTerritoryId),
  ]);

  return {
    ...toSummary(row),
    tagline: row.tagline,
    sizeBand: row.sizeBand,
    foundedYear: row.foundedYear,
    logoFileId: row.logoFileId,
    headquarters,
    ...attributes,
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
): Promise<Result<OrganizationProfileView>> {
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select()
      .from(organizations)
      .where(sql`lower(${organizations.slug}) = ${slug.trim().toLowerCase()}`)
      .limit(1);

    if (!row) return err(notFound());
    return ok(await toProfileView(tx, row));
  });
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
): Promise<Result<OrganizationProfileView>> {
  if (!canEditOrgProfile(actor, organizationId)) return err(forbidden());

  const parsed = updateOrganizationSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const data = parsed.data;

  return withActor(actor, async (tx) => {
    const [before] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!before) return err(notFound());

    // Headquarters is supplied as a territory slug — the vocabulary the UI and
    // the URLs speak. An unknown slug is a validation error, never a silently
    // dropped selection.
    let hqTerritoryId: string | null | undefined;
    if (data.hqTerritorySlug !== undefined) {
      if (data.hqTerritorySlug === null) {
        hqTerritoryId = null;
      } else {
        const [territory] = await tx
          .select({ id: territories.id })
          .from(territories)
          .where(eq(territories.slug, data.hqTerritorySlug))
          .limit(1);

        if (!territory) {
          return err({
            code: 'validation' as const,
            message: 'That location was not recognised.',
            fields: { hqTerritorySlug: `Unknown territory: ${data.hqTerritorySlug}` },
          });
        }
        hqTerritoryId = territory.id;
      }
    }

    const scalarChanges = {
      ...(data.legalName !== undefined ? { legalName: data.legalName } : {}),
      ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
      ...(data.website !== undefined ? { website: data.website || null } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.tagline !== undefined ? { tagline: data.tagline || null } : {}),
      ...(data.sizeBand !== undefined ? { sizeBand: data.sizeBand } : {}),
      ...(data.foundedYear !== undefined ? { foundedYear: data.foundedYear } : {}),
      ...(hqTerritoryId !== undefined ? { hqTerritoryId } : {}),
    };

    const hasScalarChanges = Object.keys(scalarChanges).length > 0;
    const hasAttributeChanges =
      data.industries !== undefined || data.productCategories !== undefined;

    // Editing only the industries is a legitimate update. Issuing an UPDATE
    // with an empty SET is not — so when nothing scalar changed, updated_at is
    // touched instead, which keeps the row's timestamp honest about the change
    // that did happen.
    let updated = before;
    if (hasScalarChanges || hasAttributeChanges) {
      const [row] = await tx
        .update(organizations)
        .set(hasScalarChanges ? scalarChanges : { updatedAt: new Date() })
        .where(eq(organizations.id, organizationId))
        .returning();

      if (!row) return err(notFound());
      updated = row;
    }

    const attributes = await replaceOrgAttributes(tx, organizationId, data);
    if (!attributes.ok) return err(attributes.error);

    await recordAudit(tx, actor, {
      action: 'organization.updated',
      targetType: 'organization',
      targetId: organizationId,
      before: {
        displayName: before.displayName,
        website: before.website,
        sizeBand: before.sizeBand,
      },
      after: {
        displayName: updated.displayName,
        website: updated.website,
        sizeBand: updated.sizeBand,
      },
    });

    return ok(await toProfileView(tx, updated));
  });
}

/**
 * Replaces the organisation's attribute sets wholesale.
 *
 * A full replace rather than a diff: the sets are small and bounded by
 * validation, and replacing makes deselection work correctly without a separate
 * "remove" path to get wrong.
 */
async function replaceOrgAttributes(
  tx: Tx,
  organizationId: string,
  data: UpdateOrganizationInput,
): Promise<Result<null>> {
  if (data.industries) {
    const slugs = data.industries.map((i) => i.slug);
    const rows = slugs.length
      ? await tx
          .select({ id: industries.id, slug: industries.slug, isActive: industries.isActive })
          .from(industries)
          .where(inArray(industries.slug, slugs))
      : [];

    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    const unknown = slugs.filter((slug) => !bySlug.has(slug));
    if (unknown.length > 0) {
      return err({
        code: 'validation' as const,
        message: `Unknown industries: ${unknown.join(', ')}`,
        fields: { industries: `Unknown selection: ${unknown.join(', ')}` },
      });
    }
    const retired = rows.filter((r) => !r.isActive).map((r) => r.slug);
    if (retired.length > 0) {
      return err({
        code: 'validation' as const,
        message: `No longer available: ${retired.join(', ')}`,
        fields: { industries: `No longer available: ${retired.join(', ')}` },
      });
    }

    await tx.delete(orgIndustries).where(eq(orgIndustries.organizationId, organizationId));
    if (slugs.length > 0) {
      await tx.insert(orgIndustries).values(
        slugs.map((slug) => ({ organizationId, industryId: bySlug.get(slug)!.id })),
      );
    }
  }

  if (data.productCategories) {
    const slugs = data.productCategories.map((i) => i.slug);
    const rows = slugs.length
      ? await tx
          .select({
            id: productCategories.id,
            slug: productCategories.slug,
            isActive: productCategories.isActive,
          })
          .from(productCategories)
          .where(inArray(productCategories.slug, slugs))
      : [];

    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    const unknown = slugs.filter((slug) => !bySlug.has(slug));
    if (unknown.length > 0) {
      return err({
        code: 'validation' as const,
        message: `Unknown product categories: ${unknown.join(', ')}`,
        fields: { productCategories: `Unknown selection: ${unknown.join(', ')}` },
      });
    }

    await tx
      .delete(orgProductCategories)
      .where(eq(orgProductCategories.organizationId, organizationId));
    if (slugs.length > 0) {
      await tx.insert(orgProductCategories).values(
        slugs.map((slug) => ({
          organizationId,
          productCategoryId: bySlug.get(slug)!.id,
        })),
      );
    }
  }

  return ok(null);
}

/**
 * Points an organisation at an uploaded logo.
 *
 * A database trigger independently verifies the file is in the logos bucket and
 * belongs to THIS organisation, so a company cannot point its logo at another
 * company's file even if this function were bypassed.
 */
export async function setOrganizationLogo(
  actor: Actor,
  organizationId: string,
  fileId: string | null,
): Promise<Result<{ logoFileId: string | null }>> {
  if (!canEditOrgProfile(actor, organizationId)) return err(forbidden());

  return withActor(actor, async (tx) => {
    const [updated] = await tx
      .update(organizations)
      .set({ logoFileId: fileId })
      .where(eq(organizations.id, organizationId))
      .returning({ logoFileId: organizations.logoFileId });

    if (!updated) return err(notFound());

    await recordAudit(tx, actor, {
      action: fileId ? 'organization.logo_set' : 'organization.logo_removed',
      targetType: 'organization',
      targetId: organizationId,
      after: { logoFileId: fileId },
    });

    return ok(updated);
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

  return withActor(actor, async (tx) => {
    const memberships = await tx
      .select({
        userId: organizationMembers.userId,
        orgRole: organizationMembers.orgRole,
        acceptedAt: organizationMembers.acceptedAt,
        invitedAt: organizationMembers.invitedAt,
      })
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, organizationId));

    // Names and emails come from app.org_member_directory(), NOT from a join to
    // `users`. That table is readable only by self and admin — deliberately,
    // since it also holds the email address — so a join here would silently
    // return just the caller's own row to every non-admin member, making a team
    // of five look like a team of one. The function returns exactly the two
    // columns a team list needs, and only to an accepted member of this
    // organisation.
    const directory = await tx.execute<{
      user_id: string;
      full_name: string;
      email: string;
    }>(sql`select user_id, full_name, email from app.org_member_directory(${organizationId}::uuid)`);

    const byId = new Map(
      (directory as unknown as Array<{ user_id: string; full_name: string; email: string }>).map(
        (row) => [row.user_id, row],
      ),
    );

    return ok(
      memberships.map((m) => ({
        userId: m.userId,
        orgRole: m.orgRole,
        acceptedAt: m.acceptedAt,
        invitedAt: m.invitedAt,
        fullName: byId.get(m.userId)?.full_name ?? 'Unknown',
        email: byId.get(m.userId)?.email ?? '',
      })),
    );
  });
}

/**
 * Changes a team member's role.
 *
 * Two rules the database cannot express on its own:
 *   - the owner's role is not editable here; ownership transfer is a separate,
 *     deliberate operation (and the partial unique index guarantees one owner)
 *   - nobody may raise another member to a rank at or above their own, so an
 *     admin cannot mint a peer who could then remove them
 */
export async function updateMemberRole(
  actor: Actor,
  organizationId: string,
  targetUserId: string,
  orgRole: Exclude<OrgRole, 'owner'>,
): Promise<Result<{ userId: string; orgRole: OrgRole }>> {
  if (!canManageOrgMembers(actor, organizationId)) return err(forbidden());

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

    if (member.orgRole === 'owner') {
      return err(conflict('The owner\'s role cannot be changed here.'));
    }

    // Platform admins are not bound by the org hierarchy; org members are.
    if (!isAdmin(actor)) {
      const mine = isAuthenticated(actor)
        ? actor.memberships.find((m) => m.organizationId === organizationId)
        : undefined;
      const myRank = mine ? ORG_ROLE_RANK[mine.orgRole] : 0;

      if (ORG_ROLE_RANK[orgRole] >= myRank) {
        return err(forbidden('You cannot grant a role at or above your own.'));
      }
    }

    const [updated] = await tx
      .update(organizationMembers)
      .set({ orgRole })
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, targetUserId),
        ),
      )
      .returning({ userId: organizationMembers.userId, orgRole: organizationMembers.orgRole });

    if (!updated) return err(notFound());

    await recordAudit(tx, actor, {
      action: 'organization.member_role_changed',
      targetType: 'organization',
      targetId: organizationId,
      before: { userId: targetUserId, orgRole: member.orgRole },
      after: { userId: targetUserId, orgRole },
    });

    return ok(updated);
  });
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
