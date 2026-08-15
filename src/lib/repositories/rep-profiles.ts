import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  isAdmin,
  isAuthenticated,
  type Actor,
} from '@/lib/auth/actor';
import type { Tx } from '@/lib/db/rls';
import { withActor } from '@/lib/db/rls';
import {
  compensationTypes,
  customerTypes,
  industries,
  productCategories,
  repCompensationPrefs,
  repCustomerTypes,
  repIndustries,
  repProductCategories,
  repProfiles,
  repSalesModels,
  repTerritories,
  salesModels,
  territories,
  users,
  type RepProficiency,
  type RepSeniority,
  type RepVisibility,
} from '@/lib/db/schema';
import { conflict, err, forbidden, notFound, ok, type Result } from '@/lib/errors';
import {
  scoreProfileCompleteness,
  type CompletenessResult,
} from '@/lib/rep-profile/completeness';
import { generateProfileSlug } from '@/lib/rep-profile/slug';

import { recordAudit } from './audit';

// ===========================================================================
// Views
//
// Different callers get different SHAPES, not just different rows. A public
// view has no field to leak a private one from, so a public page physically
// cannot render contact details or a compensation floor even by mistake.
// ===========================================================================

export interface RepAttribute {
  id: string;
  slug: string;
  name: string;
  proficiency?: RepProficiency;
  years?: number | null;
}

export interface RepTerritoryView {
  id: string;
  slug: string;
  name: string;
  kind: string;
  /** Ancestor names, root first, for "California › Los Angeles Metro". */
  ancestors: string[];
}

/** What anyone permitted to view the profile may see. */
export interface RepProfilePublicView {
  id: string;
  slug: string;
  fullName: string;
  headline: string;
  bio: string | null;
  yearsExperience: number | null;
  seniority: RepSeniority | null;
  avatarFileId: string | null;
  linkedinUrl: string | null;
  openToWork: boolean;
  availabilityHoursPerWeek: number | null;
  verificationStatus: string;
  visibility: RepVisibility;
  industries: RepAttribute[];
  productCategories: RepAttribute[];
  territories: RepTerritoryView[];
  customerTypes: RepAttribute[];
  salesModels: RepAttribute[];
  compensationTypes: RepAttribute[];
  createdAt: Date;
}

/**
 * The owner's own view. Adds the fields that are never shown to anyone else:
 * the compensation floor, earliest start date, and completeness breakdown.
 */
export interface RepProfileOwnerView extends RepProfilePublicView {
  email: string;
  minBaseRequired: string | null;
  currency: string;
  earliestStartDate: string | null;
  completeness: CompletenessResult;
}

// ===========================================================================
// Validation
// ===========================================================================

const SENIORITIES = [
  'sdr',
  'ae',
  'senior_ae',
  'enterprise_ae',
  'sales_manager',
  'director',
  'vp',
  'cro',
] as const;

const PROFICIENCIES = ['familiar', 'experienced', 'expert'] as const;

const attributeSelectionSchema = z.object({
  slug: z.string().trim().min(2).max(80),
  proficiency: z.enum(PROFICIENCIES).optional(),
  years: z.number().int().min(0).max(60).nullable().optional(),
});

export type AttributeSelection = z.infer<typeof attributeSelectionSchema>;

export const upsertRepProfileSchema = z
  .object({
    headline: z.string().trim().min(1, 'Add a headline').max(160),
    bio: z.string().trim().max(5000).nullable().optional(),
    yearsExperience: z.number().int().min(0).max(60).nullable().optional(),
    seniority: z.enum(SENIORITIES).nullable().optional(),
    linkedinUrl: z
      .url('Enter a valid URL')
      .max(500)
      .nullable()
      .optional()
      .or(z.literal('')),
    visibility: z.enum(['public', 'businesses_only', 'applied_only']).optional(),
    openToWork: z.boolean().optional(),
    availabilityHoursPerWeek: z.number().int().min(1).max(80).nullable().optional(),
    earliestStartDate: z.iso.date().nullable().optional(),
    minBaseRequired: z.number().min(0).max(100_000_000).nullable().optional(),
    currency: z.string().length(3).optional(),
    industries: z.array(attributeSelectionSchema).max(30).optional(),
    productCategories: z.array(attributeSelectionSchema).max(30).optional(),
    territories: z.array(attributeSelectionSchema).max(60).optional(),
    customerTypes: z.array(attributeSelectionSchema).max(15).optional(),
    salesModels: z.array(attributeSelectionSchema).max(15).optional(),
    compensationTypes: z.array(attributeSelectionSchema).max(10).optional(),
  })
  .strict();

export type UpsertRepProfileInput = z.infer<typeof upsertRepProfileSchema>;

function validationError(error: z.ZodError) {
  return err({
    code: 'validation' as const,
    message: 'Please check the highlighted fields.',
    fields: Object.fromEntries(
      error.issues.map((i) => [String(i.path[0] ?? '_'), i.message]),
    ),
  });
}

// ===========================================================================
// Attribute loading
// ===========================================================================

type TaxonomyTable =
  | typeof industries
  | typeof productCategories
  | typeof customerTypes
  | typeof salesModels
  | typeof compensationTypes;

/**
 * Resolves slugs to taxonomy ids, rejecting anything unknown or retired.
 *
 * Slugs are used at this boundary rather than ids because the UI, the seed data
 * and the URLs all speak slugs; ids are an internal detail. An unknown slug is
 * a validation error, not a silently dropped selection — quietly discarding a
 * rep's input is how profiles end up mysteriously incomplete.
 */
async function resolveSlugs(
  tx: Tx,
  table: TaxonomyTable,
  slugs: string[],
  label: string,
): Promise<Result<Map<string, string>>> {
  if (slugs.length === 0) return ok(new Map());

  const rows = await tx
    .select({ id: table.id, slug: table.slug, isActive: table.isActive })
    .from(table)
    .where(inArray(table.slug, slugs));

  const bySlug = new Map(rows.map((r) => [r.slug, r.id]));
  const unknown = slugs.filter((s) => !bySlug.has(s));

  if (unknown.length > 0) {
    return err({
      code: 'validation',
      message: `Unknown ${label}: ${unknown.join(', ')}`,
      fields: { [label]: `Unknown selection: ${unknown.join(', ')}` },
    });
  }

  const retired = rows.filter((r) => !r.isActive).map((r) => r.slug);
  if (retired.length > 0) {
    return err({
      code: 'validation',
      message: `No longer available: ${retired.join(', ')}`,
      fields: { [label]: `No longer available: ${retired.join(', ')}` },
    });
  }

  return ok(bySlug);
}

async function resolveTerritorySlugs(
  tx: Tx,
  slugs: string[],
): Promise<Result<Map<string, string>>> {
  if (slugs.length === 0) return ok(new Map());

  const rows = await tx
    .select({ id: territories.id, slug: territories.slug, isActive: territories.isActive })
    .from(territories)
    .where(inArray(territories.slug, slugs));

  const bySlug = new Map(rows.map((r) => [r.slug, r.id]));
  const unknown = slugs.filter((s) => !bySlug.has(s));

  if (unknown.length > 0) {
    return err({
      code: 'validation',
      message: `Unknown territories: ${unknown.join(', ')}`,
      fields: { territories: `Unknown selection: ${unknown.join(', ')}` },
    });
  }

  return ok(bySlug);
}

// ===========================================================================
// Reads
// ===========================================================================

interface LoadedAttributes {
  industries: RepAttribute[];
  productCategories: RepAttribute[];
  territories: RepTerritoryView[];
  customerTypes: RepAttribute[];
  salesModels: RepAttribute[];
  compensationTypes: RepAttribute[];
}

async function loadAttributes(tx: Tx, repProfileId: string): Promise<LoadedAttributes> {
  const [ind, cat, terr, cust, models, comp] = await Promise.all([
    tx
      .select({
        id: industries.id,
        slug: industries.slug,
        name: industries.name,
        proficiency: repIndustries.proficiency,
        years: repIndustries.years,
      })
      .from(repIndustries)
      .innerJoin(industries, eq(industries.id, repIndustries.industryId))
      .where(eq(repIndustries.repProfileId, repProfileId)),

    tx
      .select({
        id: productCategories.id,
        slug: productCategories.slug,
        name: productCategories.name,
        proficiency: repProductCategories.proficiency,
        years: repProductCategories.years,
      })
      .from(repProductCategories)
      .innerJoin(
        productCategories,
        eq(productCategories.id, repProductCategories.productCategoryId),
      )
      .where(eq(repProductCategories.repProfileId, repProfileId)),

    // Ancestors are resolved in the same query via the ltree path, so rendering
    // "California › Los Angeles Metro" costs no extra round trips.
    tx.execute<{
      id: string;
      slug: string;
      name: string;
      kind: string;
      ancestors: string[] | null;
    }>(sql`
      select t.id, t.slug, t.name, t.kind::text as kind,
             (
               select array_agg(a.name order by nlevel(a.path))
               from territories a
               where a.path @> t.path and a.id <> t.id
             ) as ancestors
      from rep_territories rt
      join territories t on t.id = rt.territory_id
      where rt.rep_profile_id = ${repProfileId}
      order by t.path
    `),

    tx
      .select({
        id: customerTypes.id,
        slug: customerTypes.slug,
        name: customerTypes.name,
        proficiency: repCustomerTypes.proficiency,
      })
      .from(repCustomerTypes)
      .innerJoin(customerTypes, eq(customerTypes.id, repCustomerTypes.customerTypeId))
      .where(eq(repCustomerTypes.repProfileId, repProfileId)),

    tx
      .select({
        id: salesModels.id,
        slug: salesModels.slug,
        name: salesModels.name,
        proficiency: repSalesModels.proficiency,
      })
      .from(repSalesModels)
      .innerJoin(salesModels, eq(salesModels.id, repSalesModels.salesModelId))
      .where(eq(repSalesModels.repProfileId, repProfileId)),

    tx
      .select({
        id: compensationTypes.id,
        slug: compensationTypes.slug,
        name: compensationTypes.name,
      })
      .from(repCompensationPrefs)
      .innerJoin(
        compensationTypes,
        eq(compensationTypes.id, repCompensationPrefs.compensationTypeId),
      )
      .where(eq(repCompensationPrefs.repProfileId, repProfileId)),
  ]);

  const territoryRows = terr as unknown as Array<{
    id: string;
    slug: string;
    name: string;
    kind: string;
    ancestors: string[] | null;
  }>;

  return {
    industries: ind,
    productCategories: cat,
    territories: territoryRows.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      kind: t.kind,
      ancestors: t.ancestors ?? [],
    })),
    customerTypes: cust,
    salesModels: models,
    compensationTypes: comp,
  };
}

/**
 * Fetches a profile by its public slug.
 *
 * RLS decides visibility. A profile the caller may not see returns not-found,
 * exactly as if it did not exist — a 403 would confirm the person is on
 * RepConnect, which for a rep with a current employer is itself the leak.
 */
export async function getRepProfileBySlug(
  actor: Actor,
  slug: string,
): Promise<Result<RepProfilePublicView>> {
  return withActor(actor, async (tx) => {
    // The name comes from app.rep_display_name() rather than a join to `users`.
    // `users` is readable only by self and admin — deliberately, because that
    // row also holds the email address — so a join here would return nothing
    // for any third-party viewer. The function returns just the one column, and
    // only when the profile is visible to the caller.
    const [row] = await tx
      .select({
        profile: repProfiles,
        fullName: sql<string | null>`app.rep_display_name(${repProfiles.id})`,
      })
      .from(repProfiles)
      .where(eq(repProfiles.slug, slug))
      .limit(1);

    if (!row || row.fullName === null) return err(notFound());

    const attributes = await loadAttributes(tx, row.profile.id);

    return ok({
      id: row.profile.id,
      slug: row.profile.slug,
      fullName: row.fullName,
      headline: row.profile.headline,
      bio: row.profile.bio,
      yearsExperience: row.profile.yearsExperience,
      seniority: row.profile.seniority,
      avatarFileId: row.profile.avatarFileId,
      linkedinUrl: row.profile.linkedinUrl,
      openToWork: row.profile.openToWork,
      availabilityHoursPerWeek: row.profile.availabilityHoursPerWeek,
      verificationStatus: row.profile.verificationStatus,
      visibility: row.profile.visibility,
      createdAt: row.profile.createdAt,
      ...attributes,
    });
  });
}

/** The caller's own profile, including fields nobody else sees. */
export async function getMyRepProfile(
  actor: Actor,
): Promise<Result<RepProfileOwnerView>> {
  if (!isAuthenticated(actor)) return err(forbidden());

  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({ profile: repProfiles, fullName: users.fullName, email: users.email })
      .from(repProfiles)
      .innerJoin(users, eq(users.id, repProfiles.userId))
      .where(eq(repProfiles.userId, actor.userId))
      .limit(1);

    if (!row) return err(notFound());

    const attributes = await loadAttributes(tx, row.profile.id);

    const completeness = scoreProfileCompleteness({
      headline: row.profile.headline,
      bio: row.profile.bio,
      yearsExperience: row.profile.yearsExperience,
      seniority: row.profile.seniority,
      avatarFileId: row.profile.avatarFileId,
      linkedinUrl: row.profile.linkedinUrl,
      industryCount: attributes.industries.length,
      territoryCount: attributes.territories.length,
      customerTypeCount: attributes.customerTypes.length,
      salesModelCount: attributes.salesModels.length,
      compensationPrefCount: attributes.compensationTypes.length,
    });

    return ok({
      id: row.profile.id,
      slug: row.profile.slug,
      fullName: row.fullName,
      email: row.email,
      headline: row.profile.headline,
      bio: row.profile.bio,
      yearsExperience: row.profile.yearsExperience,
      seniority: row.profile.seniority,
      avatarFileId: row.profile.avatarFileId,
      linkedinUrl: row.profile.linkedinUrl,
      openToWork: row.profile.openToWork,
      availabilityHoursPerWeek: row.profile.availabilityHoursPerWeek,
      verificationStatus: row.profile.verificationStatus,
      visibility: row.profile.visibility,
      minBaseRequired: row.profile.minBaseRequired,
      currency: row.profile.currency,
      earliestStartDate: row.profile.earliestStartDate,
      createdAt: row.profile.createdAt,
      completeness,
      ...attributes,
    });
  });
}

// ===========================================================================
// Writes
// ===========================================================================

async function replaceAttributes(
  tx: Tx,
  repProfileId: string,
  input: UpsertRepProfileInput,
): Promise<Result<null>> {
  // Each attribute set is replaced wholesale rather than diffed. The sets are
  // small and bounded by validation, and a full replace makes deselection work
  // correctly without a separate "remove" path to get wrong.

  if (input.industries) {
    const resolved = await resolveSlugs(
      tx,
      industries,
      input.industries.map((i) => i.slug),
      'industries',
    );
    if (!resolved.ok) return err(resolved.error);

    await tx.delete(repIndustries).where(eq(repIndustries.repProfileId, repProfileId));
    if (input.industries.length > 0) {
      await tx.insert(repIndustries).values(
        input.industries.map((i) => ({
          repProfileId,
          industryId: resolved.data.get(i.slug)!,
          proficiency: i.proficiency ?? 'experienced',
          years: i.years ?? null,
        })),
      );
    }
  }

  if (input.productCategories) {
    const resolved = await resolveSlugs(
      tx,
      productCategories,
      input.productCategories.map((i) => i.slug),
      'productCategories',
    );
    if (!resolved.ok) return err(resolved.error);

    await tx
      .delete(repProductCategories)
      .where(eq(repProductCategories.repProfileId, repProfileId));
    if (input.productCategories.length > 0) {
      await tx.insert(repProductCategories).values(
        input.productCategories.map((i) => ({
          repProfileId,
          productCategoryId: resolved.data.get(i.slug)!,
          proficiency: i.proficiency ?? 'experienced',
          years: i.years ?? null,
        })),
      );
    }
  }

  if (input.territories) {
    const resolved = await resolveTerritorySlugs(
      tx,
      input.territories.map((i) => i.slug),
    );
    if (!resolved.ok) return err(resolved.error);

    await tx.delete(repTerritories).where(eq(repTerritories.repProfileId, repProfileId));
    if (input.territories.length > 0) {
      await tx.insert(repTerritories).values(
        input.territories.map((i) => ({
          repProfileId,
          territoryId: resolved.data.get(i.slug)!,
        })),
      );
    }
  }

  if (input.customerTypes) {
    const resolved = await resolveSlugs(
      tx,
      customerTypes,
      input.customerTypes.map((i) => i.slug),
      'customerTypes',
    );
    if (!resolved.ok) return err(resolved.error);

    await tx
      .delete(repCustomerTypes)
      .where(eq(repCustomerTypes.repProfileId, repProfileId));
    if (input.customerTypes.length > 0) {
      await tx.insert(repCustomerTypes).values(
        input.customerTypes.map((i) => ({
          repProfileId,
          customerTypeId: resolved.data.get(i.slug)!,
          proficiency: i.proficiency ?? 'experienced',
        })),
      );
    }
  }

  if (input.salesModels) {
    const resolved = await resolveSlugs(
      tx,
      salesModels,
      input.salesModels.map((i) => i.slug),
      'salesModels',
    );
    if (!resolved.ok) return err(resolved.error);

    await tx.delete(repSalesModels).where(eq(repSalesModels.repProfileId, repProfileId));
    if (input.salesModels.length > 0) {
      await tx.insert(repSalesModels).values(
        input.salesModels.map((i) => ({
          repProfileId,
          salesModelId: resolved.data.get(i.slug)!,
          proficiency: i.proficiency ?? 'experienced',
        })),
      );
    }
  }

  if (input.compensationTypes) {
    const resolved = await resolveSlugs(
      tx,
      compensationTypes,
      input.compensationTypes.map((i) => i.slug),
      'compensationTypes',
    );
    if (!resolved.ok) return err(resolved.error);

    await tx
      .delete(repCompensationPrefs)
      .where(eq(repCompensationPrefs.repProfileId, repProfileId));
    if (input.compensationTypes.length > 0) {
      await tx.insert(repCompensationPrefs).values(
        input.compensationTypes.map((i) => ({
          repProfileId,
          compensationTypeId: resolved.data.get(i.slug)!,
        })),
      );
    }
  }

  return ok(null);
}

/**
 * Recomputes and stores completeness from the profile's current state.
 *
 * Exported so any path that changes a contributing field (setting an avatar,
 * for instance) recomputes rather than adjusting the stored number by a delta.
 * Deltas drift the moment two paths touch the same profile.
 */
export async function refreshRepProfileCompleteness(
  tx: Tx,
  repProfileId: string,
): Promise<number> {
  const [row] = await tx
    .select()
    .from(repProfiles)
    .where(eq(repProfiles.id, repProfileId))
    .limit(1);

  if (!row) return 0;

  const counts = await tx.execute<{
    industries: number;
    territories: number;
    customer_types: number;
    sales_models: number;
    compensation: number;
  }>(sql`
    select
      (select count(*)::int from rep_industries where rep_profile_id = ${repProfileId}) as industries,
      (select count(*)::int from rep_territories where rep_profile_id = ${repProfileId}) as territories,
      (select count(*)::int from rep_customer_types where rep_profile_id = ${repProfileId}) as customer_types,
      (select count(*)::int from rep_sales_models where rep_profile_id = ${repProfileId}) as sales_models,
      (select count(*)::int from rep_compensation_prefs where rep_profile_id = ${repProfileId}) as compensation
  `);

  const c = (counts as unknown as Array<Record<string, number>>)[0] ?? {};

  const { score } = scoreProfileCompleteness({
    headline: row.headline,
    bio: row.bio,
    yearsExperience: row.yearsExperience,
    seniority: row.seniority,
    avatarFileId: row.avatarFileId,
    linkedinUrl: row.linkedinUrl,
    industryCount: c.industries ?? 0,
    territoryCount: c.territories ?? 0,
    customerTypeCount: c.customer_types ?? 0,
    salesModelCount: c.sales_models ?? 0,
    compensationPrefCount: c.compensation ?? 0,
  });

  await tx
    .update(repProfiles)
    .set({ profileCompleteness: score })
    .where(eq(repProfiles.id, repProfileId));

  return score;
}

/**
 * Creates the caller's rep profile.
 *
 * The slug is generated here, not supplied — a user-chosen public identifier
 * would need its own moderation problem solving (impersonation, squatting,
 * profanity) for no benefit at this stage.
 */
export async function createRepProfile(
  actor: Actor,
  input: UpsertRepProfileInput,
): Promise<Result<{ id: string; slug: string; completeness: number }>> {
  if (!isAuthenticated(actor)) return err(forbidden());

  const parsed = upsertRepProfileSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);

  return withActor(actor, async (tx) => {
    const [existing] = await tx
      .select({ id: repProfiles.id })
      .from(repProfiles)
      .where(eq(repProfiles.userId, actor.userId))
      .limit(1);

    if (existing) return err(conflict('You already have a rep profile.'));

    const [me] = await tx
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, actor.userId))
      .limit(1);

    if (!me) return err(notFound());

    // Collision is very unlikely but not impossible; retry rather than fail.
    let slug = generateProfileSlug(me.fullName);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const [taken] = await tx
        .select({ id: repProfiles.id })
        .from(repProfiles)
        .where(eq(repProfiles.slug, slug))
        .limit(1);
      if (!taken) break;
      slug = generateProfileSlug(me.fullName);
    }

    const [created] = await tx
      .insert(repProfiles)
      .values({
        userId: actor.userId,
        slug,
        headline: parsed.data.headline,
        bio: parsed.data.bio ?? null,
        yearsExperience: parsed.data.yearsExperience ?? null,
        seniority: parsed.data.seniority ?? null,
        linkedinUrl: parsed.data.linkedinUrl || null,
        visibility: parsed.data.visibility ?? 'businesses_only',
        openToWork: parsed.data.openToWork ?? true,
        availabilityHoursPerWeek: parsed.data.availabilityHoursPerWeek ?? null,
        earliestStartDate: parsed.data.earliestStartDate ?? null,
        minBaseRequired:
          parsed.data.minBaseRequired !== undefined && parsed.data.minBaseRequired !== null
            ? String(parsed.data.minBaseRequired)
            : null,
        currency: parsed.data.currency ?? 'USD',
      })
      .returning({ id: repProfiles.id, slug: repProfiles.slug });

    if (!created) return err(conflict('Could not create the profile.'));

    const attributes = await replaceAttributes(tx, created.id, parsed.data);
    if (!attributes.ok) return err(attributes.error);

    const completeness = await refreshRepProfileCompleteness(tx, created.id);

    await recordAudit(tx, actor, {
      action: 'rep_profile.created',
      targetType: 'rep_profile',
      targetId: created.id,
      after: { slug: created.slug, visibility: parsed.data.visibility ?? 'businesses_only' },
    });

    return ok({ ...created, completeness });
  });
}

export async function updateRepProfile(
  actor: Actor,
  input: UpsertRepProfileInput,
): Promise<Result<{ id: string; slug: string; completeness: number }>> {
  if (!isAuthenticated(actor)) return err(forbidden());

  const parsed = upsertRepProfileSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);

  return withActor(actor, async (tx) => {
    const [before] = await tx
      .select()
      .from(repProfiles)
      .where(eq(repProfiles.userId, actor.userId))
      .limit(1);

    if (!before) return err(notFound());

    // Ownership is in the WHERE clause, not a preceding check — zero rows
    // updated is the refusal, with no window between checking and writing.
    const [updated] = await tx
      .update(repProfiles)
      .set({
        headline: parsed.data.headline,
        bio: parsed.data.bio ?? null,
        yearsExperience: parsed.data.yearsExperience ?? null,
        seniority: parsed.data.seniority ?? null,
        linkedinUrl: parsed.data.linkedinUrl || null,
        ...(parsed.data.visibility !== undefined
          ? { visibility: parsed.data.visibility }
          : {}),
        ...(parsed.data.openToWork !== undefined
          ? { openToWork: parsed.data.openToWork }
          : {}),
        availabilityHoursPerWeek: parsed.data.availabilityHoursPerWeek ?? null,
        earliestStartDate: parsed.data.earliestStartDate ?? null,
        minBaseRequired:
          parsed.data.minBaseRequired !== undefined && parsed.data.minBaseRequired !== null
            ? String(parsed.data.minBaseRequired)
            : null,
        ...(parsed.data.currency !== undefined ? { currency: parsed.data.currency } : {}),
      })
      .where(
        and(eq(repProfiles.id, before.id), eq(repProfiles.userId, actor.userId)),
      )
      .returning({ id: repProfiles.id, slug: repProfiles.slug });

    if (!updated) return err(notFound());

    const attributes = await replaceAttributes(tx, updated.id, parsed.data);
    if (!attributes.ok) return err(attributes.error);

    const completeness = await refreshRepProfileCompleteness(tx, updated.id);

    await recordAudit(tx, actor, {
      action: 'rep_profile.updated',
      targetType: 'rep_profile',
      targetId: updated.id,
      before: { visibility: before.visibility, headline: before.headline },
      after: { visibility: parsed.data.visibility ?? before.visibility },
    });

    return ok({ ...updated, completeness });
  });
}

/**
 * Changing visibility is separated from the general update because it is the
 * single most consequential field on the profile: it decides who in the world
 * can see this person is looking. It gets its own audit entry so the history is
 * answerable if a rep ever asks "who could see me, and when?".
 */
export async function setRepProfileVisibility(
  actor: Actor,
  visibility: RepVisibility,
): Promise<Result<{ visibility: RepVisibility }>> {
  if (!isAuthenticated(actor)) return err(forbidden());

  return withActor(actor, async (tx) => {
    const [before] = await tx
      .select({ id: repProfiles.id, visibility: repProfiles.visibility })
      .from(repProfiles)
      .where(eq(repProfiles.userId, actor.userId))
      .limit(1);

    if (!before) return err(notFound());

    const [updated] = await tx
      .update(repProfiles)
      .set({ visibility })
      .where(eq(repProfiles.userId, actor.userId))
      .returning({ visibility: repProfiles.visibility });

    if (!updated) return err(notFound());

    await recordAudit(tx, actor, {
      action: 'rep_profile.visibility_changed',
      targetType: 'rep_profile',
      targetId: before.id,
      before: { visibility: before.visibility },
      after: { visibility: updated.visibility },
    });

    return ok(updated);
  });
}

/**
 * Admin read. A separate function rather than a branch inside a user-facing
 * one, so admin-scoped access stays greppable and cannot be reached by
 * autocomplete from a member page.
 */
export async function adminGetRepProfile(
  actor: Actor,
  repProfileId: string,
): Promise<Result<RepProfilePublicView>> {
  if (!isAdmin(actor)) return err(forbidden());

  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({ profile: repProfiles, fullName: users.fullName })
      .from(repProfiles)
      .innerJoin(users, eq(users.id, repProfiles.userId))
      .where(eq(repProfiles.id, repProfileId))
      .limit(1);

    if (!row) return err(notFound());

    const attributes = await loadAttributes(tx, row.profile.id);

    return ok({
      id: row.profile.id,
      slug: row.profile.slug,
      fullName: row.fullName,
      headline: row.profile.headline,
      bio: row.profile.bio,
      yearsExperience: row.profile.yearsExperience,
      seniority: row.profile.seniority,
      avatarFileId: row.profile.avatarFileId,
      linkedinUrl: row.profile.linkedinUrl,
      openToWork: row.profile.openToWork,
      availabilityHoursPerWeek: row.profile.availabilityHoursPerWeek,
      verificationStatus: row.profile.verificationStatus,
      visibility: row.profile.visibility,
      createdAt: row.profile.createdAt,
      ...attributes,
    });
  });
}
