import 'server-only';

import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { isAdmin, type Actor } from '@/lib/auth/actor';
import { withActor } from '@/lib/db/rls';
import {
  compensationTypes,
  customerTypes,
  industries,
  productCategories,
  salesModels,
  territories,
} from '@/lib/db/schema';
import type { TerritoryKind } from '@/lib/db/schema';
import { conflict, err, forbidden, notFound, ok, type Result } from '@/lib/errors';

import { recordAudit } from './audit';

/**
 * Taxonomy reads are public — anonymous visitors need filter options before
 * they sign up, and public opportunity pages render these names. Writes are
 * admin-only, enforced here and again by RLS.
 *
 * Reads deliberately do NOT filter is_active by default. A retired entry must
 * still resolve, or a profile referencing it renders with a hole. Pickers ask
 * for activeOnly; anything rendering existing data does not.
 */

export const HIERARCHICAL_TAXONOMIES = ['industries', 'product-categories', 'territories'] as const;
export type HierarchicalTaxonomy = (typeof HIERARCHICAL_TAXONOMIES)[number];

export const FLAT_TAXONOMIES = ['customer-types', 'sales-models', 'compensation-types'] as const;
export type FlatTaxonomy = (typeof FLAT_TAXONOMIES)[number];

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface TaxonomyNode {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  path: string;
  depth: number;
  isActive: boolean;
  children: TaxonomyNode[];
}

export interface TerritoryNode extends TaxonomyNode {
  kind: TerritoryKind;
  subdivisionType: string | null;
  isoCode: string | null;
}

export interface FlatTaxonomyEntry {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

export interface CompensationTypeEntry extends FlatTaxonomyEntry {
  hasGuaranteedPay: boolean;
}

interface FlatRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  path: string;
  parentId: string | null;
  isActive: boolean;
}

/**
 * Assembles rows into a tree in one pass.
 *
 * Rows arrive ordered by path, so a parent is always seen before its children
 * and no second pass or recursive query is needed.
 */
function buildTree<T extends FlatRow, N extends TaxonomyNode>(
  rows: T[],
  toNode: (row: T, depth: number) => N,
): N[] {
  const byId = new Map<string, N>();
  const roots: N[] = [];

  for (const row of rows) {
    const depth = row.path.split('.').length;
    const node = toNode(row, depth);
    byId.set(row.id, node);

    const parent = row.parentId ? byId.get(row.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      // A node whose parent was filtered out (inactive, say) is surfaced at the
      // top rather than silently dropped — losing entries is worse than an
      // imperfect shape.
      roots.push(node);
    }
  }

  return roots;
}

// ---------------------------------------------------------------------------
// Hierarchical reads
// ---------------------------------------------------------------------------

export async function listIndustries(
  actor: Actor,
  options: { activeOnly?: boolean } = {},
): Promise<Result<TaxonomyNode[]>> {
  const rows = await withActor(actor, async (tx) => {
    const query = tx
      .select({
        id: industries.id,
        slug: industries.slug,
        name: industries.name,
        description: industries.description,
        path: sql<string>`${industries.path}::text`,
        parentId: industries.parentId,
        isActive: industries.isActive,
      })
      .from(industries)
      .orderBy(asc(industries.path));

    return options.activeOnly
      ? query.where(eq(industries.isActive, true))
      : query;
  });

  return ok(
    buildTree(rows, (row, depth) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      path: row.path,
      depth,
      isActive: row.isActive,
      children: [],
    })),
  );
}

export async function listProductCategories(
  actor: Actor,
  options: { activeOnly?: boolean } = {},
): Promise<Result<TaxonomyNode[]>> {
  const rows = await withActor(actor, async (tx) => {
    const query = tx
      .select({
        id: productCategories.id,
        slug: productCategories.slug,
        name: productCategories.name,
        description: productCategories.description,
        path: sql<string>`${productCategories.path}::text`,
        parentId: productCategories.parentId,
        isActive: productCategories.isActive,
      })
      .from(productCategories)
      .orderBy(asc(productCategories.path));

    return options.activeOnly
      ? query.where(eq(productCategories.isActive, true))
      : query;
  });

  return ok(
    buildTree(rows, (row, depth) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      path: row.path,
      depth,
      isActive: row.isActive,
      children: [],
    })),
  );
}

export async function listTerritories(
  actor: Actor,
  options: { activeOnly?: boolean; maxDepth?: number } = {},
): Promise<Result<TerritoryNode[]>> {
  const rows = await withActor(actor, async (tx) => {
    const conditions = [];
    if (options.activeOnly) conditions.push(eq(territories.isActive, true));
    if (options.maxDepth !== undefined) {
      conditions.push(sql`nlevel(${territories.path}) <= ${options.maxDepth}`);
    }

    const query = tx
      .select({
        id: territories.id,
        slug: territories.slug,
        name: territories.name,
        description: sql<string | null>`null::text`,
        path: sql<string>`${territories.path}::text`,
        parentId: territories.parentId,
        isActive: territories.isActive,
        kind: territories.kind,
        subdivisionType: territories.subdivisionType,
        isoCode: territories.isoCode,
      })
      .from(territories)
      .orderBy(asc(territories.path));

    return conditions.length > 0
      ? query.where(sql.join(conditions, sql` and `))
      : query;
  });

  return ok(
    buildTree(rows, (row, depth) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      path: row.path,
      depth,
      isActive: row.isActive,
      kind: row.kind,
      subdivisionType: row.subdivisionType,
      isoCode: row.isoCode,
      children: [],
    })),
  );
}

/**
 * The ancestor chain for a territory, root first — so the UI can render
 * "California › Los Angeles Metro" without N queries.
 */
export async function getTerritoryAncestors(
  actor: Actor,
  territoryId: string,
): Promise<Result<Array<{ id: string; slug: string; name: string; kind: TerritoryKind }>>> {
  const rows = await withActor(actor, async (tx) =>
    tx.execute<{ id: string; slug: string; name: string; kind: TerritoryKind }>(
      sql`select id, slug, name, kind from app.territory_ancestors(${territoryId}::uuid)`,
    ),
  );

  const list = rows as unknown as Array<{
    id: string;
    slug: string;
    name: string;
    kind: TerritoryKind;
  }>;

  return list.length > 0 ? ok(list) : err(notFound());
}

// ---------------------------------------------------------------------------
// Flat reads
// ---------------------------------------------------------------------------

export async function listCustomerTypes(
  actor: Actor,
  options: { activeOnly?: boolean } = {},
): Promise<Result<FlatTaxonomyEntry[]>> {
  const rows = await withActor(actor, async (tx) => {
    const query = tx
      .select({
        id: customerTypes.id,
        slug: customerTypes.slug,
        name: customerTypes.name,
        description: customerTypes.description,
        isActive: customerTypes.isActive,
      })
      .from(customerTypes)
      .orderBy(asc(customerTypes.sortOrder));

    return options.activeOnly ? query.where(eq(customerTypes.isActive, true)) : query;
  });

  return ok(rows);
}

export async function listSalesModels(
  actor: Actor,
  options: { activeOnly?: boolean } = {},
): Promise<Result<FlatTaxonomyEntry[]>> {
  const rows = await withActor(actor, async (tx) => {
    const query = tx
      .select({
        id: salesModels.id,
        slug: salesModels.slug,
        name: salesModels.name,
        description: salesModels.description,
        isActive: salesModels.isActive,
      })
      .from(salesModels)
      .orderBy(asc(salesModels.sortOrder));

    return options.activeOnly ? query.where(eq(salesModels.isActive, true)) : query;
  });

  return ok(rows);
}

export async function listCompensationTypes(
  actor: Actor,
  options: { activeOnly?: boolean } = {},
): Promise<Result<CompensationTypeEntry[]>> {
  const rows = await withActor(actor, async (tx) => {
    const query = tx
      .select({
        id: compensationTypes.id,
        slug: compensationTypes.slug,
        name: compensationTypes.name,
        description: compensationTypes.description,
        isActive: compensationTypes.isActive,
        hasGuaranteedPay: compensationTypes.hasGuaranteedPay,
      })
      .from(compensationTypes)
      .orderBy(asc(compensationTypes.sortOrder));

    return options.activeOnly ? query.where(eq(compensationTypes.isActive, true)) : query;
  });

  return ok(rows);
}

// ---------------------------------------------------------------------------
// Admin writes
//
// Kept in this module rather than a separate admin one because taxonomy has no
// per-user dimension at all: there is no non-admin version of these operations
// to accidentally reach for.
// ---------------------------------------------------------------------------

export const createTaxonomyEntrySchema = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens only.'),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    parentSlug: z.string().trim().optional(),
    sortOrder: z.number().int().min(0).max(100000).optional(),
  })
  .strict();

export type CreateTaxonomyEntryInput = z.infer<typeof createTaxonomyEntrySchema>;

const HIERARCHICAL_TABLES = {
  industries,
  'product-categories': productCategories,
} as const;

/**
 * Adds an industry or product category, at any depth.
 *
 * This is the mechanism that keeps RepConnect industry-agnostic over time:
 * growing the taxonomy — a new vertical, a deeper sub-category, a whole new
 * branch — is an INSERT, never a schema change and never a migration of
 * existing profiles. `path` is derived by trigger from parentSlug.
 */
export async function createTaxonomyEntry(
  actor: Actor,
  taxonomy: 'industries' | 'product-categories',
  input: CreateTaxonomyEntryInput,
): Promise<Result<{ id: string; slug: string }>> {
  if (!isAdmin(actor)) return err(forbidden());

  const parsed = createTaxonomyEntrySchema.safeParse(input);
  if (!parsed.success) {
    return err({
      code: 'validation',
      message: 'Please check the highlighted fields.',
      fields: Object.fromEntries(
        parsed.error.issues.map((i) => [String(i.path[0] ?? '_'), i.message]),
      ),
    });
  }

  const table = HIERARCHICAL_TABLES[taxonomy];

  return withActor(actor, async (tx) => {
    const [existing] = await tx
      .select({ id: table.id })
      .from(table)
      .where(eq(table.slug, parsed.data.slug))
      .limit(1);

    if (existing) return err(conflict(`"${parsed.data.slug}" already exists.`));

    let parentId: string | null = null;
    if (parsed.data.parentSlug) {
      const [parent] = await tx
        .select({ id: table.id })
        .from(table)
        .where(eq(table.slug, parsed.data.parentSlug))
        .limit(1);

      if (!parent) return err(notFound(`Parent "${parsed.data.parentSlug}" does not exist.`));
      parentId = parent.id;
    }

    const [created] = await tx
      .insert(table)
      .values({
        slug: parsed.data.slug,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        parentId,
        sortOrder: parsed.data.sortOrder ?? 0,
        // `path` is intentionally absent: the trigger derives it.
      })
      .returning({ id: table.id, slug: table.slug });

    if (!created) return err(conflict('Could not create the entry.'));

    await recordAudit(tx, actor, {
      action: 'taxonomy.entry_created',
      targetType: taxonomy,
      targetId: created.id,
      after: { slug: created.slug, name: parsed.data.name, parentSlug: parsed.data.parentSlug },
    });

    return ok(created);
  });
}

/**
 * Retires an entry. Deliberately not a delete: profiles and opportunities
 * reference these rows, and the foreign keys are ON DELETE RESTRICT. Retiring
 * removes it from pickers while leaving existing references intact.
 */
export async function setTaxonomyEntryActive(
  actor: Actor,
  taxonomy: 'industries' | 'product-categories',
  slug: string,
  isActive: boolean,
): Promise<Result<{ slug: string; isActive: boolean }>> {
  if (!isAdmin(actor)) return err(forbidden());

  const table = HIERARCHICAL_TABLES[taxonomy];

  return withActor(actor, async (tx) => {
    const [updated] = await tx
      .update(table)
      .set({ isActive })
      .where(eq(table.slug, slug))
      .returning({ slug: table.slug, isActive: table.isActive });

    if (!updated) return err(notFound());

    await recordAudit(tx, actor, {
      action: isActive ? 'taxonomy.entry_reactivated' : 'taxonomy.entry_retired',
      targetType: taxonomy,
      after: { slug, isActive },
    });

    return ok(updated);
  });
}

/**
 * Row counts per vocabulary. Admin-only: it is operational information, not
 * something a member needs.
 */
export async function countTaxonomyEntries(
  actor: Actor,
): Promise<Result<Record<string, number>>> {
  if (!isAdmin(actor)) return err(forbidden());

  const rows = await withActor(actor, async (tx) =>
    tx.execute<{ name: string; total: number; active: number }>(sql`
      select 'industries' as name, count(*)::int as total,
             count(*) filter (where is_active)::int as active from industries
      union all select 'product categories', count(*)::int,
             count(*) filter (where is_active)::int from product_categories
      union all select 'territories', count(*)::int,
             count(*) filter (where is_active)::int from territories
      union all select 'customer types', count(*)::int,
             count(*) filter (where is_active)::int from customer_types
      union all select 'sales models', count(*)::int,
             count(*) filter (where is_active)::int from sales_models
      union all select 'compensation types', count(*)::int,
             count(*) filter (where is_active)::int from compensation_types
    `),
  );

  const list = rows as unknown as Array<{ name: string; total: number; active: number }>;
  return ok(Object.fromEntries(list.map((r) => [r.name, r.total])));
}
