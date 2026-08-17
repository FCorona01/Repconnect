import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  consentPolicyTypeEnum,
  fileBucketEnum,
  fileScanStatusEnum,
  fileVisibilityEnum,
  orgRoleEnum,
  orgSizeBandEnum,
  orgStatusEnum,
  platformRoleEnum,
  userStatusEnum,
  verificationStatusEnum,
} from './enums';

const primaryId = () =>
  uuid('id')
    .primaryKey()
    .default(sql`app.uuid_generate_v7()`);

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------
export const users = pgTable(
  'users',
  {
    id: primaryId(),
    authUserId: uuid('auth_user_id').unique(),
    email: text('email').notNull(),
    fullName: text('full_name').notNull(),
    platformRole: platformRoleEnum('platform_role').notNull().default('member'),
    status: userStatusEnum('status').notNull().default('pending_verification'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_lower_key').on(sql`lower(${t.email})`),
    index('users_status_idx').on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// organizations
// ---------------------------------------------------------------------------
export const organizations = pgTable(
  'organizations',
  {
    id: primaryId(),
    slug: text('slug').notNull(),
    legalName: text('legal_name').notNull(),
    displayName: text('display_name').notNull(),
    website: text('website'),
    description: text('description'),
    tagline: text('tagline'),
    sizeBand: orgSizeBandEnum('size_band'),
    foundedYear: integer('founded_year'),
    hqTerritoryId: uuid('hq_territory_id'),
    logoFileId: uuid('logo_file_id'),
    status: orgStatusEnum('status').notNull().default('active'),
    verificationStatus: verificationStatusEnum('verification_status')
      .notNull()
      .default('unverified'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('organizations_slug_key').on(sql`lower(${t.slug})`),
    index('organizations_status_idx').on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// organization_members
// ---------------------------------------------------------------------------
export const organizationMembers = pgTable(
  'organization_members',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgRole: orgRoleEnum('org_role').notNull().default('viewer'),
    invitedBy: uuid('invited_by').references(() => users.id),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('organization_members_unique').on(t.organizationId, t.userId),
  ],
);

// ---------------------------------------------------------------------------
// files
// ---------------------------------------------------------------------------
export const files = pgTable(
  'files',
  {
    id: primaryId(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    bucket: fileBucketEnum('bucket').notNull(),
    visibility: fileVisibilityEnum('visibility').notNull().default('private'),
    storagePath: text('storage_path').notNull(),
    originalFilename: text('original_filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksumSha256: text('checksum_sha256'),
    scanStatus: fileScanStatusEnum('scan_status').notNull().default('pending'),
    /** Recorded at upload so pages can reserve space and avoid layout shift. */
    imageWidth: integer('image_width'),
    imageHeight: integer('image_height'),
    createdAt: createdAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('files_storage_path_key').on(t.bucket, t.storagePath)],
);

// ---------------------------------------------------------------------------
// audit_logs — append-only
// ---------------------------------------------------------------------------
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: primaryId(),
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    actorRole: text('actor_role').notNull(),
    impersonatedBy: uuid('impersonated_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    beforeState: jsonb('before_state'),
    afterState: jsonb('after_state'),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_target_idx').on(t.targetType, t.targetId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// consents
// ---------------------------------------------------------------------------
export const consents = pgTable(
  'consents',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    policyType: consentPolicyTypeEnum('policy_type').notNull(),
    policyVersion: text('policy_version').notNull(),
    granted: boolean('granted').notNull(),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [index('consents_user_idx').on(t.userId, t.policyType)],
);

export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type FileRecord = typeof files.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
