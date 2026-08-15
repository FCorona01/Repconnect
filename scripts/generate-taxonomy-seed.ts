/**
 * Compiles src/lib/taxonomy/seed/* into supabase/migrations/0008_taxonomy_seed.sql
 *
 *   pnpm db:generate-seed
 *
 * Why generate rather than hand-write the SQL: the source lists are readable
 * and reviewable, while the SQL stays deterministic and the migration runner
 * stays a plain SQL runner. CI regenerates and fails if the committed file
 * differs, so the two cannot drift.
 *
 * Validation happens here rather than in SQL, because a duplicate slug or a
 * dangling parent should stop the build, not the deployment.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { INDUSTRIES } from '../src/lib/taxonomy/seed/industries';
import { PRODUCT_CATEGORIES } from '../src/lib/taxonomy/seed/product-categories';
import {
  CA_METROS,
  CA_REGIONS,
  CA_SUBDIVISIONS,
  COUNTRIES,
  ROOT,
  US_METROS,
  US_REGIONS,
  US_SUBDIVISIONS,
} from '../src/lib/taxonomy/seed/territories';
import type { MetroSeed, RegionSeed, SubdivisionSeed } from '../src/lib/taxonomy/seed/territories';
import type { CompensationEntry, FlatEntry, TreeNode } from '../src/lib/taxonomy/seed/types';
import {
  COMPENSATION_TYPES,
  CUSTOMER_TYPES,
  SALES_MODELS,
} from '../src/lib/taxonomy/seed/vocabularies';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function fail(message: string): never {
  console.error(`\nTaxonomy seed is invalid:\n  ${message}\n`);
  process.exit(1);
}

/** SQL string literal. Names contain apostrophes ("St. John's"), so this matters. */
function lit(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'null';
  return `'${value.replace(/'/g, "''")}'`;
}

function checkSlug(slug: string, context: string): void {
  if (!SLUG_RE.test(slug)) {
    fail(`${context}: "${slug}" is not a valid slug (lowercase, digits, single hyphens).`);
  }
  if (slug.length < 2 || slug.length > 80) {
    fail(`${context}: "${slug}" must be between 2 and 80 characters.`);
  }
}

/** Slugs must be unique per table — they are the permanent public identifier. */
function assertUniqueSlugs(slugs: string[], table: string): void {
  const seen = new Set<string>();
  for (const slug of slugs) {
    if (seen.has(slug)) fail(`${table}: duplicate slug "${slug}".`);
    seen.add(slug);
  }
}

// ---------------------------------------------------------------------------
// Hierarchical vocabularies
// ---------------------------------------------------------------------------

interface FlatRow {
  slug: string;
  name: string;
  description?: string;
  parentSlug: string | null;
  sortOrder: number;
}

function flattenTree(nodes: TreeNode[], table: string): FlatRow[] {
  const rows: FlatRow[] = [];

  const walk = (list: TreeNode[], parentSlug: string | null): void => {
    list.forEach((node, index) => {
      checkSlug(node.slug, table);
      rows.push({
        slug: node.slug,
        name: node.name,
        ...(node.description !== undefined ? { description: node.description } : {}),
        parentSlug,
        sortOrder: index * 10,
      });
      if (node.children?.length) walk(node.children, node.slug);
    });
  };

  walk(nodes, null);
  assertUniqueSlugs(rows.map((r) => r.slug), table);
  return rows;
}

/**
 * Emits inserts parent-before-child. The path trigger resolves a parent by id,
 * so a child inserted first would fail — ordering is a correctness requirement,
 * not a stylistic one.
 */
function emitHierarchy(table: string, rows: FlatRow[]): string {
  const lines = [
    `-- ${table}: ${rows.length} entries`,
    `insert into ${table} (slug, name, description, parent_id, sort_order) values`,
  ];

  const byDepth = [...rows].sort((a, b) => depthOf(a, rows) - depthOf(b, rows));

  const values = byDepth.map((row) => {
    const parent =
      row.parentSlug === null
        ? 'null'
        : `(select id from ${table} where slug = ${lit(row.parentSlug)})`;
    return `  (${lit(row.slug)}, ${lit(row.name)}, ${lit(row.description ?? null)}, ${parent}, ${row.sortOrder})`;
  });

  // A single multi-row INSERT cannot reference rows it is itself inserting, so
  // each depth level is its own statement.
  const levels = new Map<number, string[]>();
  byDepth.forEach((row, i) => {
    const d = depthOf(row, rows);
    const list = levels.get(d) ?? [];
    list.push(values[i]!);
    levels.set(d, list);
  });

  const statements: string[] = [`-- ${table}: ${rows.length} entries`];
  for (const [depth, vals] of [...levels.entries()].sort((a, b) => a[0] - b[0])) {
    statements.push(
      `-- depth ${depth}`,
      `insert into ${table} (slug, name, description, parent_id, sort_order) values`,
      `${vals.join(',\n')};`,
      '',
    );
  }

  void lines;
  return statements.join('\n');
}

function depthOf(row: FlatRow, all: FlatRow[]): number {
  let depth = 0;
  let current = row;
  const byslug = new Map(all.map((r) => [r.slug, r]));
  while (current.parentSlug !== null) {
    const parent = byslug.get(current.parentSlug);
    if (!parent) fail(`Dangling parent "${current.parentSlug}" for "${current.slug}".`);
    current = parent;
    depth += 1;
    if (depth > 20) fail(`Cycle detected at "${row.slug}".`);
  }
  return depth;
}

// ---------------------------------------------------------------------------
// Flat vocabularies
// ---------------------------------------------------------------------------

function emitFlat(table: string, entries: FlatEntry[]): string {
  entries.forEach((e) => checkSlug(e.slug, table));
  assertUniqueSlugs(entries.map((e) => e.slug), table);

  const values = entries
    .map(
      (e, i) =>
        `  (${lit(e.slug)}, ${lit(e.name)}, ${lit(e.description ?? null)}, ${i * 10})`,
    )
    .join(',\n');

  return [
    `-- ${table}: ${entries.length} entries`,
    `insert into ${table} (slug, name, description, sort_order) values`,
    `${values};`,
    '',
  ].join('\n');
}

function emitCompensation(entries: CompensationEntry[]): string {
  entries.forEach((e) => checkSlug(e.slug, 'compensation_types'));
  assertUniqueSlugs(entries.map((e) => e.slug), 'compensation_types');

  const values = entries
    .map(
      (e, i) =>
        `  (${lit(e.slug)}, ${lit(e.name)}, ${lit(e.description ?? null)}, ${e.hasGuaranteedPay}, ${i * 10})`,
    )
    .join(',\n');

  return [
    `-- compensation_types: ${entries.length} entries`,
    'insert into compensation_types (slug, name, description, has_guaranteed_pay, sort_order) values',
    `${values};`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Territories
// ---------------------------------------------------------------------------

function emitTerritories(): { sql: string; count: number } {
  const allSlugs: string[] = [ROOT.slug];
  const parts: string[] = [];

  checkSlug(ROOT.slug, 'territories');

  parts.push(
    '-- depth 0: the root — "Anywhere / Fully Remote", ancestor of everything',
    'insert into territories (slug, name, kind, sort_order) values',
    `  (${lit(ROOT.slug)}, ${lit(ROOT.name)}, 'global', 0);`,
    '',
  );

  // Countries
  COUNTRIES.forEach((c) => {
    checkSlug(c.slug, 'territories');
    allSlugs.push(c.slug);
  });
  parts.push(
    '-- depth 1: countries. Selecting one of these means "nationwide".',
    'insert into territories (slug, name, kind, iso_code, parent_id, sort_order) values',
    COUNTRIES.map(
      (c, i) =>
        `  (${lit(c.slug)}, ${lit(c.name)}, 'country', ${lit(c.iso)}, (select id from territories where slug = ${lit(ROOT.slug)}), ${i * 10})`,
    ).join(',\n') + ';',
    '',
  );

  // Regions
  const regions: Array<RegionSeed & { country: string }> = [
    ...US_REGIONS.map((r) => ({ ...r, country: 'united-states' })),
    ...CA_REGIONS.map((r) => ({ ...r, country: 'canada' })),
  ];
  regions.forEach((r) => {
    checkSlug(r.slug, 'territories');
    allSlugs.push(r.slug);
  });
  parts.push(
    '-- depth 2: regions',
    'insert into territories (slug, name, kind, parent_id, sort_order) values',
    regions
      .map(
        (r, i) =>
          `  (${lit(r.slug)}, ${lit(r.name)}, 'region', (select id from territories where slug = ${lit(r.country)}), ${i * 10})`,
      )
      .join(',\n') + ';',
    '',
  );

  // Subdivisions
  const regionSlugs = new Set(regions.map((r) => r.slug));
  const subdivisions: SubdivisionSeed[] = [...US_SUBDIVISIONS, ...CA_SUBDIVISIONS];
  subdivisions.forEach((s) => {
    checkSlug(s.slug, 'territories');
    if (!regionSlugs.has(s.region)) {
      fail(`territories: subdivision "${s.slug}" references unknown region "${s.region}".`);
    }
    allSlugs.push(s.slug);
  });
  parts.push(
    '-- depth 3: states, districts, provinces and territories',
    'insert into territories (slug, name, kind, subdivision_type, iso_code, parent_id, sort_order) values',
    subdivisions
      .map(
        (s, i) =>
          `  (${lit(s.slug)}, ${lit(s.name)}, 'subdivision', ${lit(s.type)}, ${lit(s.iso)}, (select id from territories where slug = ${lit(s.region)}), ${i * 10})`,
      )
      .join(',\n') + ';',
    '',
  );

  // Metros
  const subdivisionSlugs = new Set(subdivisions.map((s) => s.slug));
  const metros: MetroSeed[] = [...US_METROS, ...CA_METROS];
  metros.forEach((m) => {
    checkSlug(m.slug, 'territories');
    if (!subdivisionSlugs.has(m.subdivision)) {
      fail(`territories: metro "${m.slug}" references unknown subdivision "${m.subdivision}".`);
    }
    allSlugs.push(m.slug);
  });
  parts.push(
    '-- depth 4: metropolitan areas',
    'insert into territories (slug, name, kind, parent_id, sort_order) values',
    metros
      .map(
        (m, i) =>
          `  (${lit(m.slug)}, ${lit(m.name)}, 'metro', (select id from territories where slug = ${lit(m.subdivision)}), ${i * 10})`,
      )
      .join(',\n') + ';',
    '',
  );

  assertUniqueSlugs(allSlugs, 'territories');

  return { sql: parts.join('\n'), count: allSlugs.length };
}

// ---------------------------------------------------------------------------

function main(): void {
  const industries = flattenTree(INDUSTRIES, 'industries');
  const productCategories = flattenTree(PRODUCT_CATEGORIES, 'product_categories');
  const territories = emitTerritories();

  const sql = `-- ===========================================================================
-- 0008_taxonomy_seed
--
-- GENERATED FILE — DO NOT EDIT BY HAND.
--
-- Source:    src/lib/taxonomy/seed/*.ts
-- Regenerate: pnpm db:generate-seed
--
-- CI regenerates this file and fails if the result differs from what is
-- committed, so the SQL and the TypeScript source cannot drift apart.
--
-- Adding entries later is INSERT-only work — a new industry, sub-category or
-- whole branch needs no schema change and no migration of user data. Slugs are
-- permanent; retire an entry with is_active = false rather than deleting it.
--
-- Contents:
--   industries          ${industries.length}
--   product_categories  ${productCategories.length}
--   territories         ${territories.count}
--   customer_types      ${CUSTOMER_TYPES.length}
--   sales_models        ${SALES_MODELS.length}
--   compensation_types  ${COMPENSATION_TYPES.length}
-- ===========================================================================

${emitHierarchy('industries', industries)}
${emitHierarchy('product_categories', productCategories)}
${territories.sql}
${emitFlat('customer_types', CUSTOMER_TYPES)}
${emitFlat('sales_models', SALES_MODELS)}
${emitCompensation(COMPENSATION_TYPES)}`;

  const target = join(process.cwd(), 'supabase', 'migrations', '0008_taxonomy_seed.sql');
  writeFileSync(target, sql, 'utf8');

  console.log('Generated supabase/migrations/0008_taxonomy_seed.sql');
  console.log(`  industries          ${industries.length}`);
  console.log(`  product_categories  ${productCategories.length}`);
  console.log(`  territories         ${territories.count}`);
  console.log(`  customer_types      ${CUSTOMER_TYPES.length}`);
  console.log(`  sales_models        ${SALES_MODELS.length}`);
  console.log(`  compensation_types  ${COMPENSATION_TYPES.length}`);
}

main();
