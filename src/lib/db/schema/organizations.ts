import { index, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { OrgSizeBand } from './enums';
import { industries, productCategories } from './taxonomy';
import { organizations } from './tables';

/** Display labels, kept beside the enum so a new band cannot ship unlabelled. */
export const SIZE_BAND_LABELS: Record<OrgSizeBand, string> = {
  '1-10': '1–10 employees',
  '11-50': '11–50 employees',
  '51-200': '51–200 employees',
  '201-1000': '201–1,000 employees',
  '1000+': '1,000+ employees',
};

/**
 * Organisation attributes, drawn from the SAME vocabularies reps use.
 *
 * That symmetry is the point: Phase 7 matching compares a business's
 * industries against a rep's industries directly, with no translation step
 * between two different descriptions of the world.
 */
export const orgIndustries = pgTable(
  'org_industries',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    industryId: uuid('industry_id')
      .notNull()
      .references(() => industries.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.industryId] }),
    index('org_industries_industry_idx').on(t.industryId),
  ],
);

export const orgProductCategories = pgTable(
  'org_product_categories',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    productCategoryId: uuid('product_category_id')
      .notNull()
      .references(() => productCategories.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.productCategoryId] }),
    index('org_product_categories_category_idx').on(t.productCategoryId),
  ],
);
