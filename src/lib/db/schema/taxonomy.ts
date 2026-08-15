import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { territoryKindEnum } from './enums';

/**
 * ltree has no built-in Drizzle type. Values are opaque strings here
 * ('anywhere.united_states.us_west.california'); all hierarchy reasoning is
 * done in SQL via app.paths_overlap, which is what the GiST index can serve.
 */
export const ltree = customType<{ data: string; driverData: string }>({
  dataType: () => 'ltree',
});

const taxonomyId = () =>
  uuid('id')
    .primaryKey()
    .default(sql`app.uuid_generate_v7()`);

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/**
 * `path` is maintained entirely by database trigger from `parent_id` and is
 * never written by application code.
 *
 * It carries `.default('')` so inserts may omit it — the BEFORE trigger always
 * replaces that placeholder, and a CHECK constraint (nlevel(path) >= 1) makes
 * a dropped trigger fail loudly rather than silently corrupt the hierarchy.
 * Never pass a value for it.
 */

export const industries = pgTable(
  'industries',
  {
    id: taxonomyId(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    parentId: uuid('parent_id'),
    path: ltree('path').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('industries_slug_key').on(t.slug),
    index('industries_parent_idx').on(t.parentId),
  ],
);

export const productCategories = pgTable(
  'product_categories',
  {
    id: taxonomyId(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    parentId: uuid('parent_id'),
    path: ltree('path').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('product_categories_slug_key').on(t.slug),
    index('product_categories_parent_idx').on(t.parentId),
  ],
);

export const territories = pgTable(
  'territories',
  {
    id: taxonomyId(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    kind: territoryKindEnum('kind').notNull(),
    subdivisionType: text('subdivision_type'),
    isoCode: text('iso_code'),
    parentId: uuid('parent_id'),
    path: ltree('path').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('territories_slug_key').on(t.slug),
    index('territories_parent_idx').on(t.parentId),
  ],
);

export const customerTypes = pgTable(
  'customer_types',
  {
    id: taxonomyId(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('customer_types_slug_key').on(t.slug)],
);

export const salesModels = pgTable(
  'sales_models',
  {
    id: taxonomyId(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('sales_models_slug_key').on(t.slug)],
);

export const compensationTypes = pgTable(
  'compensation_types',
  {
    id: taxonomyId(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /**
     * Whether the arrangement includes money not contingent on closing.
     * A hard gate in matching, never a weighted score.
     */
    hasGuaranteedPay: boolean('has_guaranteed_pay').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('compensation_types_slug_key').on(t.slug)],
);

export type Industry = typeof industries.$inferSelect;
export type ProductCategory = typeof productCategories.$inferSelect;
export type Territory = typeof territories.$inferSelect;
export type CustomerType = typeof customerTypes.$inferSelect;
export type SalesModel = typeof salesModels.$inferSelect;
export type CompensationType = typeof compensationTypes.$inferSelect;
