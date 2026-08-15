import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { verificationStatusEnum } from './enums';
import {
  compensationTypes,
  customerTypes,
  industries,
  productCategories,
  salesModels,
  territories,
} from './taxonomy';
import { files, users } from './tables';

export const repSeniorityEnum = pgEnum('rep_seniority', [
  'sdr',
  'ae',
  'senior_ae',
  'enterprise_ae',
  'sales_manager',
  'director',
  'vp',
  'cro',
]);

export const repVisibilityEnum = pgEnum('rep_visibility', [
  'public',
  'businesses_only',
  'applied_only',
]);

export const repProficiencyEnum = pgEnum('rep_proficiency', [
  'familiar',
  'experienced',
  'expert',
]);

export type RepSeniority = (typeof repSeniorityEnum.enumValues)[number];
export type RepVisibility = (typeof repVisibilityEnum.enumValues)[number];
export type RepProficiency = (typeof repProficiencyEnum.enumValues)[number];

/** Display labels. Kept beside the enum so a new value cannot ship unlabelled. */
export const SENIORITY_LABELS: Record<RepSeniority, string> = {
  sdr: 'SDR / BDR',
  ae: 'Account Executive',
  senior_ae: 'Senior Account Executive',
  enterprise_ae: 'Enterprise Account Executive',
  sales_manager: 'Sales Manager',
  director: 'Sales Director',
  vp: 'VP of Sales',
  cro: 'Chief Revenue Officer',
};

export const VISIBILITY_LABELS: Record<RepVisibility, string> = {
  public: 'Public — anyone can view, including search engines',
  businesses_only: 'Businesses only — signed-in businesses can view',
  applied_only: 'Private — only businesses you apply to',
};

export const PROFICIENCY_LABELS: Record<RepProficiency, string> = {
  familiar: 'Familiar',
  experienced: 'Experienced',
  expert: 'Expert',
};

export const repProfiles = pgTable(
  'rep_profiles',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`app.uuid_generate_v7()`),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    headline: text('headline').notNull(),
    bio: text('bio'),
    yearsExperience: integer('years_experience'),
    seniority: repSeniorityEnum('seniority'),
    avatarFileId: uuid('avatar_file_id').references(() => files.id, {
      onDelete: 'set null',
    }),
    linkedinUrl: text('linkedin_url'),
    visibility: repVisibilityEnum('visibility').notNull().default('businesses_only'),
    openToWork: boolean('open_to_work').notNull().default(true),
    availabilityHoursPerWeek: integer('availability_hours_per_week'),
    earliestStartDate: date('earliest_start_date'),
    minBaseRequired: numeric('min_base_required', { precision: 12, scale: 2 }),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    profileCompleteness: integer('profile_completeness').notNull().default(0),
    verificationStatus: verificationStatusEnum('verification_status')
      .notNull()
      .default('unverified'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // search_vector is a generated column, maintained by PostgreSQL. It is not
    // mapped here because nothing in application code reads or writes it —
    // full-text queries reference it directly in SQL.
  },
  (t) => [
    uniqueIndex('rep_profiles_slug_key').on(t.slug),
    index('rep_profiles_discoverable_idx').on(t.visibility, t.profileCompleteness),
  ],
);

// ---------------------------------------------------------------------------
// Attribute join tables
// ---------------------------------------------------------------------------

export const repIndustries = pgTable(
  'rep_industries',
  {
    repProfileId: uuid('rep_profile_id')
      .notNull()
      .references(() => repProfiles.id, { onDelete: 'cascade' }),
    industryId: uuid('industry_id')
      .notNull()
      .references(() => industries.id, { onDelete: 'restrict' }),
    proficiency: repProficiencyEnum('proficiency').notNull().default('experienced'),
    years: integer('years'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.repProfileId, t.industryId] })],
);

export const repProductCategories = pgTable(
  'rep_product_categories',
  {
    repProfileId: uuid('rep_profile_id')
      .notNull()
      .references(() => repProfiles.id, { onDelete: 'cascade' }),
    productCategoryId: uuid('product_category_id')
      .notNull()
      .references(() => productCategories.id, { onDelete: 'restrict' }),
    proficiency: repProficiencyEnum('proficiency').notNull().default('experienced'),
    years: integer('years'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.repProfileId, t.productCategoryId] })],
);

export const repTerritories = pgTable(
  'rep_territories',
  {
    repProfileId: uuid('rep_profile_id')
      .notNull()
      .references(() => repProfiles.id, { onDelete: 'cascade' }),
    territoryId: uuid('territory_id')
      .notNull()
      .references(() => territories.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.repProfileId, t.territoryId] })],
);

export const repCustomerTypes = pgTable(
  'rep_customer_types',
  {
    repProfileId: uuid('rep_profile_id')
      .notNull()
      .references(() => repProfiles.id, { onDelete: 'cascade' }),
    customerTypeId: uuid('customer_type_id')
      .notNull()
      .references(() => customerTypes.id, { onDelete: 'restrict' }),
    proficiency: repProficiencyEnum('proficiency').notNull().default('experienced'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.repProfileId, t.customerTypeId] })],
);

export const repSalesModels = pgTable(
  'rep_sales_models',
  {
    repProfileId: uuid('rep_profile_id')
      .notNull()
      .references(() => repProfiles.id, { onDelete: 'cascade' }),
    salesModelId: uuid('sales_model_id')
      .notNull()
      .references(() => salesModels.id, { onDelete: 'restrict' }),
    proficiency: repProficiencyEnum('proficiency').notNull().default('experienced'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.repProfileId, t.salesModelId] })],
);

export const repCompensationPrefs = pgTable(
  'rep_compensation_prefs',
  {
    repProfileId: uuid('rep_profile_id')
      .notNull()
      .references(() => repProfiles.id, { onDelete: 'cascade' }),
    compensationTypeId: uuid('compensation_type_id')
      .notNull()
      .references(() => compensationTypes.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.repProfileId, t.compensationTypeId] })],
);

export type RepProfile = typeof repProfiles.$inferSelect;
