import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * These mirror the enum types created in supabase/migrations.
 * The SQL migrations are the source of truth; this file is the typed surface.
 */

export const platformRoleEnum = pgEnum('platform_role', [
  'member',
  'admin',
  'superadmin',
]);

export const userStatusEnum = pgEnum('user_status', [
  'pending_verification',
  'active',
  'suspended',
  'deactivated',
]);

export const orgRoleEnum = pgEnum('org_role', [
  'owner',
  'admin',
  'recruiter',
  'viewer',
]);

export const orgStatusEnum = pgEnum('org_status', [
  'active',
  'suspended',
  'deleted',
]);

export const verificationStatusEnum = pgEnum('verification_status', [
  'unverified',
  'pending',
  'verified',
  'rejected',
]);

export const fileBucketEnum = pgEnum('file_bucket', [
  'avatars',
  'logos',
  'documents',
  'verification',
]);

export const fileVisibilityEnum = pgEnum('file_visibility', [
  'private',
  'org',
  'public',
]);

export const fileScanStatusEnum = pgEnum('file_scan_status', [
  'pending',
  'clean',
  'infected',
  'skipped',
]);

export const consentPolicyTypeEnum = pgEnum('consent_policy_type', [
  'terms',
  'privacy',
  'marketing',
]);

export const orgSizeBandEnum = pgEnum('org_size_band', [
  '1-10',
  '11-50',
  '51-200',
  '201-1000',
  '1000+',
]);

export const territoryKindEnum = pgEnum('territory_kind', [
  'global',
  'country',
  'region',
  'subdivision',
  'metro',
]);

export type PlatformRole = (typeof platformRoleEnum.enumValues)[number];
export type UserStatus = (typeof userStatusEnum.enumValues)[number];
export type OrgRole = (typeof orgRoleEnum.enumValues)[number];
export type OrgStatus = (typeof orgStatusEnum.enumValues)[number];
export type FileBucket = (typeof fileBucketEnum.enumValues)[number];
export type FileVisibility = (typeof fileVisibilityEnum.enumValues)[number];
export type TerritoryKind = (typeof territoryKindEnum.enumValues)[number];
export type OrgSizeBand = (typeof orgSizeBandEnum.enumValues)[number];

/**
 * Ranking used for "admin or above" style checks.
 * Mirrors app.org_role_rank() in SQL — the two must stay in step, which the
 * integration tests assert.
 */
export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  owner: 40,
  admin: 30,
  recruiter: 20,
  viewer: 10,
};
