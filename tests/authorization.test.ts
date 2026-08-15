import { afterAll, describe, expect, it } from 'vitest';

import { ANONYMOUS } from '@/lib/auth/actor';
import {
  acceptInvitation,
  addMember,
  createOrganization as createOrg,
  getOrganizationById,
  listMembers,
  listMyOrganizations,
  removeMember,
  updateOrganization,
} from '@/lib/repositories/organizations';
import { getSelf, getUserById, setPlatformRole, updateProfile } from '@/lib/repositories/users';
import { listAuditForTarget } from '@/lib/repositories/audit';

import {
  actorFor,
  addMembership,
  closeDb,
  createOrganization,
  createUser,
} from './setup/fixtures';

afterAll(closeDb);

/**
 * THE AUTHORIZATION MATRIX
 *
 * The highest-value tests in this repository. Each asserts a specific attack
 * from docs/03-security.md is prevented — not that the happy path works.
 *
 * Every future phase adds rows here. A feature is not done until its
 * cross-tenant denial cases are covered.
 */

describe('Threat 1 — a user cannot read another user\'s information', () => {
  it('cannot read another user\'s private fields', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const bobActor = await actorFor(bob.id);

    const result = await getUserById(bobActor, alice.id);

    // Not visible at all — and reported as not-found, never as forbidden,
    // so the response does not confirm the record exists.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_found');
  });

  it('can read itself', async () => {
    const alice = await createUser({ fullName: 'Alice Example' });
    const actor = await actorFor(alice.id);

    const result = await getSelf(actor);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe(alice.id);
      expect(result.data.email).toBe(alice.email);
    }
  });

  it('cannot update another user\'s profile', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const bobActor = await actorFor(bob.id);

    const result = await updateProfile(bobActor, alice.id, {
      fullName: 'Renamed By Attacker',
    });

    expect(result.ok).toBe(false);

    // And the record is genuinely untouched, not merely reported as refused.
    const adminUser = await createUser({ platformRole: 'superadmin' });
    const check = await getSelf(await actorFor(alice.id));
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.data.fullName).not.toBe('Renamed By Attacker');
    expect(adminUser.id).toBeDefined();
  });

  it('anonymous callers get nothing', async () => {
    const alice = await createUser();

    expect((await getSelf(ANONYMOUS)).ok).toBe(false);
    expect((await getUserById(ANONYMOUS, alice.id)).ok).toBe(false);
  });
});

describe('Threat 2 — a business cannot access another business\'s data', () => {
  it('cannot list another organisation\'s members', async () => {
    const ownerA = await createUser();
    const ownerB = await createUser();
    const orgA = await createOrganization(ownerA.id);
    await createOrganization(ownerB.id);

    const result = await listMembers(await actorFor(ownerB.id), orgA.id);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_found');
  });

  it('a member sees only their own organisations', async () => {
    const ownerA = await createUser();
    const ownerB = await createUser();
    const orgA = await createOrganization(ownerA.id);
    const orgB = await createOrganization(ownerB.id);

    const result = await listMyOrganizations(await actorFor(ownerA.id));

    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.data.map((o) => o.id);
      expect(ids).toContain(orgA.id);
      expect(ids).not.toContain(orgB.id);
    }
  });

  it('a pending invitation grants no access until accepted', async () => {
    const owner = await createUser();
    const invitee = await createUser();
    const org = await createOrganization(owner.id);

    await addMembership(org.id, invitee.id, 'recruiter', /* accepted */ false);

    const inviteeActor = await actorFor(invitee.id);
    expect(inviteeActor.kind === 'user' && inviteeActor.memberships).toEqual([]);

    const members = await listMembers(inviteeActor, org.id);
    expect(members.ok).toBe(false);

    // After accepting, access begins.
    const accepted = await acceptInvitation(inviteeActor, org.id);
    expect(accepted.ok).toBe(true);

    const afterAccept = await listMembers(await actorFor(invitee.id), org.id);
    expect(afterAccept.ok).toBe(true);
  });
});

describe('Threat 3 — unauthorized modification is refused', () => {
  it('a non-member cannot update an organisation', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const org = await createOrganization(owner.id);

    const result = await updateOrganization(await actorFor(outsider.id), org.id, {
      displayName: 'Hijacked',
    });

    expect(result.ok).toBe(false);

    const check = await getOrganizationById(await actorFor(owner.id), org.id);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.data.displayName).not.toBe('Hijacked');
  });

  it('a viewer cannot update the organisation, an admin can', async () => {
    const owner = await createUser();
    const viewer = await createUser();
    const orgAdmin = await createUser();
    const org = await createOrganization(owner.id);

    await addMembership(org.id, viewer.id, 'viewer');
    await addMembership(org.id, orgAdmin.id, 'admin');

    const asViewer = await updateOrganization(await actorFor(viewer.id), org.id, {
      displayName: 'Viewer Edit',
    });
    expect(asViewer.ok).toBe(false);

    const asAdmin = await updateOrganization(await actorFor(orgAdmin.id), org.id, {
      displayName: 'Admin Edit',
    });
    expect(asAdmin.ok).toBe(true);
  });

  it('a recruiter cannot add team members', async () => {
    const owner = await createUser();
    const recruiter = await createUser();
    const outsider = await createUser();
    const org = await createOrganization(owner.id);
    await addMembership(org.id, recruiter.id, 'recruiter');

    const result = await addMember(await actorFor(recruiter.id), org.id, {
      email: outsider.email,
      orgRole: 'viewer',
    });

    expect(result.ok).toBe(false);
  });

  it('the owner cannot be removed, which would orphan the organisation', async () => {
    const owner = await createUser();
    const orgAdmin = await createUser();
    const org = await createOrganization(owner.id);
    await addMembership(org.id, orgAdmin.id, 'admin');

    const result = await removeMember(await actorFor(orgAdmin.id), org.id, owner.id);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('conflict');
  });
});

describe('Threat 4 — normal users cannot reach admin functions', () => {
  it('a member cannot read the audit log', async () => {
    const user = await createUser();
    const org = await createOrganization(user.id);

    const result = await listAuditForTarget(
      await actorFor(user.id),
      'organization',
      org.id,
    );

    expect(result.ok).toBe(false);
  });

  it('an admin can read the audit log', async () => {
    const admin = await createUser({ platformRole: 'admin' });
    const owner = await createUser();
    const org = await createOrg(await actorFor(owner.id), {
      slug: `audited-${Date.now().toString(36)}`,
      legalName: 'Audited Ltd',
      displayName: 'Audited',
    });

    expect(org.ok).toBe(true);
    if (!org.ok) return;

    const result = await listAuditForTarget(
      await actorFor(admin.id),
      'organization',
      org.data.id,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.some((e) => e.action === 'organization.created')).toBe(true);
    }
  });

  it('a member cannot grant themselves a platform role', async () => {
    const user = await createUser();

    const result = await setPlatformRole(await actorFor(user.id), user.id, 'superadmin');

    expect(result.ok).toBe(false);
  });

  it('an admin cannot escalate — only a superadmin may change roles', async () => {
    const admin = await createUser({ platformRole: 'admin' });
    const target = await createUser();

    const result = await setPlatformRole(await actorFor(admin.id), target.id, 'admin');

    expect(result.ok).toBe(false);
  });

  it('a superadmin cannot change their own role', async () => {
    const superadmin = await createUser({ platformRole: 'superadmin' });

    const result = await setPlatformRole(
      await actorFor(superadmin.id),
      superadmin.id,
      'member',
    );

    expect(result.ok).toBe(false);
  });

  it('a superadmin can promote another user, and it is audited', async () => {
    const superadmin = await createUser({ platformRole: 'superadmin' });
    const target = await createUser();

    const result = await setPlatformRole(
      await actorFor(superadmin.id),
      target.id,
      'admin',
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.platformRole).toBe('admin');

    const audit = await listAuditForTarget(
      await actorFor(superadmin.id),
      'user',
      target.id,
    );
    expect(audit.ok).toBe(true);
    if (audit.ok) {
      expect(
        audit.data.some((e) => e.action === 'user.platform_role_changed'),
      ).toBe(true);
    }
  });
});

describe('Threat 5 — ID manipulation and mass assignment', () => {
  it('substituting another user\'s id into an update is refused', async () => {
    const alice = await createUser();
    const bob = await createUser();

    const result = await updateProfile(await actorFor(bob.id), alice.id, {
      fullName: 'Owned',
    });

    expect(result.ok).toBe(false);
  });

  it('unknown fields are rejected rather than silently applied', async () => {
    const user = await createUser();

    const result = await updateProfile(
      await actorFor(user.id),
      user.id,
      // A crafted request attempting privilege escalation through the profile form.
      { fullName: 'Fine', platformRole: 'superadmin' } as never,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('validation');

    const self = await getSelf(await actorFor(user.id));
    expect(self.ok).toBe(true);
    if (self.ok) expect(self.data.platformRole).toBe('member');
  });

  it('a random unguessable id yields not-found, not an error leak', async () => {
    const user = await createUser();
    const result = await getOrganizationById(
      await actorFor(user.id),
      '01890000-0000-7000-8000-000000000000',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_found');
  });
});

describe('Business rules', () => {
  it('organisation slugs are unique, case-insensitively', async () => {
    const a = await createUser();
    const b = await createUser();
    const slug = `dup-${Date.now().toString(36)}`;

    const first = await createOrg(await actorFor(a.id), {
      slug,
      legalName: 'First Ltd',
      displayName: 'First',
    });
    expect(first.ok).toBe(true);

    const second = await createOrg(await actorFor(b.id), {
      slug: slug.toUpperCase(),
      legalName: 'Second Ltd',
      displayName: 'Second',
    });

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('conflict');
  });

  it('creating an organisation makes the creator its owner atomically', async () => {
    const user = await createUser();
    const actor = await actorFor(user.id);

    const created = await createOrg(actor, {
      slug: `atomic-${Date.now().toString(36)}`,
      legalName: 'Atomic Ltd',
      displayName: 'Atomic',
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const members = await listMembers(await actorFor(user.id), created.data.id);
    expect(members.ok).toBe(true);
    if (members.ok) {
      expect(members.data).toHaveLength(1);
      expect(members.data[0]?.orgRole).toBe('owner');
      expect(members.data[0]?.acceptedAt).not.toBeNull();
    }
  });

  it('an invalid slug is rejected before it reaches the database', async () => {
    const user = await createUser();

    const result = await createOrg(await actorFor(user.id), {
      slug: 'Not A Valid Slug!',
      legalName: 'X Ltd',
      displayName: 'X',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
      expect(result.error.fields?.slug).toBeDefined();
    }
  });
});
