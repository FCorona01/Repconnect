import { sql } from 'drizzle-orm';

import type { Actor, AdminActor, UserActor } from '@/lib/auth/actor';
import { db } from '@/lib/db/client';
import { organizationMembers, organizations, users } from '@/lib/db/schema';
import type { OrgRole, PlatformRole } from '@/lib/db/schema';

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter += 1).toString(36)}`;

/**
 * Fixtures are created through the privileged connection deliberately: setting
 * up test data must not itself depend on the authorization rules under test,
 * or a policy bug could hide behind a fixture that silently created nothing.
 */

export async function createUser(options?: {
  platformRole?: PlatformRole;
  fullName?: string;
  status?: 'active' | 'pending_verification' | 'suspended';
}): Promise<{ id: string; email: string }> {
  const email = `user-${unique()}@example.test`;
  const [row] = await db
    .insert(users)
    .values({
      email,
      fullName: options?.fullName ?? 'Test User',
      platformRole: options?.platformRole ?? 'member',
      status: options?.status ?? 'active',
      emailVerifiedAt: new Date(),
    })
    .returning({ id: users.id, email: users.email });

  if (!row) throw new Error('Failed to create user fixture');
  return row;
}

export async function createOrganization(ownerId: string): Promise<{ id: string; slug: string }> {
  const slug = `org-${unique()}`;
  const [org] = await db
    .insert(organizations)
    .values({
      slug,
      legalName: `${slug} Ltd`,
      displayName: slug,
      createdBy: ownerId,
    })
    .returning({ id: organizations.id, slug: organizations.slug });

  if (!org) throw new Error('Failed to create organization fixture');

  await db.insert(organizationMembers).values({
    organizationId: org.id,
    userId: ownerId,
    orgRole: 'owner',
    acceptedAt: new Date(),
  });

  return org;
}

export async function addMembership(
  organizationId: string,
  userId: string,
  orgRole: OrgRole,
  accepted = true,
): Promise<void> {
  await db.insert(organizationMembers).values({
    organizationId,
    userId,
    orgRole,
    acceptedAt: accepted ? new Date() : null,
  });
}

/** Builds an Actor the same way session resolution does, from real rows. */
export async function actorFor(userId: string): Promise<Actor> {
  const [row] = await db
    .select({ id: users.id, platformRole: users.platformRole })
    .from(users)
    .where(sql`${users.id} = ${userId}`)
    .limit(1);

  if (!row) throw new Error(`No user ${userId}`);

  const memberRows = await db
    .select({
      organizationId: organizationMembers.organizationId,
      orgRole: organizationMembers.orgRole,
    })
    .from(organizationMembers)
    .where(
      sql`${organizationMembers.userId} = ${userId} and ${organizationMembers.acceptedAt} is not null`,
    );

  const memberships = memberRows.map((m) => ({
    organizationId: m.organizationId,
    orgRole: m.orgRole,
  }));

  if (row.platformRole === 'admin' || row.platformRole === 'superadmin') {
    return {
      kind: 'admin',
      userId: row.id,
      platformRole: row.platformRole,
      memberships,
    } satisfies AdminActor;
  }

  return {
    kind: 'user',
    userId: row.id,
    platformRole: 'member',
    memberships,
  } satisfies UserActor;
}

export async function closeDb(): Promise<void> {
  const { sqlClient } = await import('@/lib/db/client');
  await sqlClient.end({ timeout: 5 });
}
