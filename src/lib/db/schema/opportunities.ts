import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  commissionBasisEnum,
  engagementTypeEnum,
  opportunitySourceEnum,
  opportunityStatusEnum,
  paymentFrequencyEnum,
  type EngagementType,
  type OpportunityStatus,
} from './enums';
import { repSeniorityEnum } from './rep-profiles';
import {
  compensationTypes,
  customerTypes,
  industries,
  productCategories,
  salesModels,
  territories,
} from './taxonomy';
import { organizations, users } from './tables';

/**
 * Display labels, kept beside the enums so a new value cannot ship unlabelled.
 */
export const ENGAGEMENT_TYPE_LABELS: Record<EngagementType, string> = {
  full_time: 'Full time',
  part_time: 'Part time',
  fractional: 'Fractional',
  project: 'Project / fixed term',
};

export const OPPORTUNITY_STATUS_LABELS: Record<OpportunityStatus, string> = {
  draft: 'Draft',
  pending_review: 'Awaiting review',
  open: 'Open',
  paused: 'Paused',
  filled: 'Filled',
  closed: 'Closed',
  archived: 'Archived',
};

/**
 * Statuses whose pages remain publicly reachable.
 *
 * A shared or indexed link must never break, so a filled or closed listing
 * still renders — it just says so, and is excluded from browse and the sitemap.
 */
export const PUBLICLY_READABLE_STATUSES: OpportunityStatus[] = [
  'open',
  'paused',
  'filled',
  'closed',
];

/** The only status that appears in browse, search and the sitemap. */
export const LIVE_STATUS: OpportunityStatus = 'open';

export const opportunities = pgTable(
  'opportunities',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`app.uuid_generate_v7()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),

    slug: text('slug').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    description: text('description').notNull(),
    responsibilities: text('responsibilities'),
    requirements: text('requirements'),

    seniorityRequired: repSeniorityEnum('seniority_required'),
    minYearsExperience: integer('min_years_experience'),

    engagementType: engagementTypeEnum('engagement_type').notNull(),
    expectedHoursPerWeek: integer('expected_hours_per_week'),
    durationMonths: integer('duration_months'),

    isRemote: boolean('is_remote').notNull().default(false),
    travelPercentage: integer('travel_percentage'),

    openings: integer('openings').notNull().default(1),

    status: opportunityStatusEnum('status').notNull().default('draft'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    closesAt: timestamp('closes_at', { withTimezone: true }),

    source: opportunitySourceEnum('source').notNull().default('organic'),

    viewCount: integer('view_count').notNull().default(0),
    applicationCount: integer('application_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // search_vector is a generated column maintained by PostgreSQL. Not mapped:
    // nothing in application code reads or writes it, and full-text queries
    // reference it directly in SQL.
  },
  (t) => [
    uniqueIndex('opportunities_slug_key').on(t.slug),
    index('opportunities_org_idx').on(t.organizationId, t.status),
  ],
);

/**
 * Compensation is a stack, not a number.
 *
 * `opportunity_compensation_discloses_a_figure` in migration 0012 refuses a row
 * that states nothing, and a trigger refuses to publish a listing with no rows
 * at all. Pay disclosure is therefore a database guarantee, not a form rule.
 */
export const opportunityCompensation = pgTable(
  'opportunity_compensation',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`app.uuid_generate_v7()`),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    compensationTypeId: uuid('compensation_type_id')
      .notNull()
      .references(() => compensationTypes.id, { onDelete: 'restrict' }),

    isPrimary: boolean('is_primary').notNull().default(false),

    baseMin: numeric('base_min', { precision: 12, scale: 2 }),
    baseMax: numeric('base_max', { precision: 12, scale: 2 }),

    commissionRateMin: numeric('commission_rate_min', { precision: 5, scale: 2 }),
    commissionRateMax: numeric('commission_rate_max', { precision: 5, scale: 2 }),
    commissionBasis: commissionBasisEnum('commission_basis'),

    oteMin: numeric('ote_min', { precision: 12, scale: 2 }),
    oteMax: numeric('ote_max', { precision: 12, scale: 2 }),

    retainerAmount: numeric('retainer_amount', { precision: 12, scale: 2 }),
    paymentFrequency: paymentFrequencyEnum('payment_frequency'),

    equityOffered: boolean('equity_offered').notNull().default(false),
    notes: text('notes'),

    currency: char('currency', { length: 3 }).notNull().default('USD'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('opportunity_compensation_opportunity_idx').on(t.opportunityId)],
);

export const opportunityStatusHistory = pgTable(
  'opportunity_status_history',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`app.uuid_generate_v7()`),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    fromStatus: opportunityStatusEnum('from_status'),
    toStatus: opportunityStatusEnum('to_status').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('opportunity_status_history_opportunity_idx').on(t.opportunityId)],
);

// ---------------------------------------------------------------------------
// Attribute joins
//
// `is_required` is the opportunity-side counterpart to the rep side's
// `proficiency`. That asymmetry is what lets Phase 7 scoring separate a hard
// requirement from a preference.
// ---------------------------------------------------------------------------

export const opportunityIndustries = pgTable(
  'opportunity_industries',
  {
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    industryId: uuid('industry_id')
      .notNull()
      .references(() => industries.id, { onDelete: 'restrict' }),
    isRequired: boolean('is_required').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.opportunityId, t.industryId] })],
);

export const opportunityProductCategories = pgTable(
  'opportunity_product_categories',
  {
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    productCategoryId: uuid('product_category_id')
      .notNull()
      .references(() => productCategories.id, { onDelete: 'restrict' }),
    isRequired: boolean('is_required').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.opportunityId, t.productCategoryId] })],
);

export const opportunityTerritories = pgTable(
  'opportunity_territories',
  {
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    territoryId: uuid('territory_id')
      .notNull()
      .references(() => territories.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.opportunityId, t.territoryId] })],
);

export const opportunityCustomerTypes = pgTable(
  'opportunity_customer_types',
  {
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    customerTypeId: uuid('customer_type_id')
      .notNull()
      .references(() => customerTypes.id, { onDelete: 'restrict' }),
    isRequired: boolean('is_required').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.opportunityId, t.customerTypeId] })],
);

export const opportunitySalesModels = pgTable(
  'opportunity_sales_models',
  {
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    salesModelId: uuid('sales_model_id')
      .notNull()
      .references(() => salesModels.id, { onDelete: 'restrict' }),
    isRequired: boolean('is_required').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.opportunityId, t.salesModelId] })],
);

/**
 * A rep's saved listings. Strictly private — a business must never learn who
 * has been eyeing its listing, which would chill saving entirely.
 */
export const savedOpportunities = pgTable(
  'saved_opportunities',
  {
    repProfileId: uuid('rep_profile_id').notNull(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.repProfileId, t.opportunityId] })],
);

export type Opportunity = typeof opportunities.$inferSelect;
export type OpportunityCompensation = typeof opportunityCompensation.$inferSelect;
export type OpportunityStatusHistoryRow = typeof opportunityStatusHistory.$inferSelect;
