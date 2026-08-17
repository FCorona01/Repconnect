import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';

import { ANONYMOUS } from '@/lib/auth/actor';
import { db } from '@/lib/db/client';
import { withActor } from '@/lib/db/rls';
import { uploadFile } from '@/lib/repositories/files';
import {
  createOrganization as createOrg,
  getOrganizationBySlug,
  listMembers,
  removeMember,
  setOrganizationLogo,
  updateMemberRole,
  updateOrganization,
} from '@/lib/repositories/organizations';

import {
  actorFor,
  addMembership,
  closeDb,
  createOrganization,
  createUser,
} from './setup/fixtures';

afterAll(closeDb);

const png = () =>
  sharp({ create: { width: 200, height: 200, channels: 3, background: '#123456' } })
    .png()
    .toBuffer();

async function orgWithOwner() {
  const owner = await createUser({ fullName: 'Owner Person' });
  const org = await createOrganization(owner.id);
  return { owner, org, ownerActor: await actorFor(owner.id) };
}

// ===========================================================================
// Company profile
// ===========================================================================

describe('organisation profile', () => {
  it('an org admin can fill out the profile, and it renders publicly', async () => {
    const { org, ownerActor } = await orgWithOwner();

    const updated = await updateOrganization(ownerActor, org.id, {
      displayName: 'Northwind Devices',
      tagline: 'Surgical implants for outpatient centres',
      description: 'We make things.',
      sizeBand: '51-200',
      foundedYear: 2014,
      hqTerritorySlug: 'los-angeles-metro',
      industries: [{ slug: 'medical-devices' }],
      productCategories: [{ slug: 'medical-capital-equipment' }],
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;

    // Active organisations are public — businesses want to be found.
    const publicView = await getOrganizationBySlug(ANONYMOUS, org.slug);
    expect(publicView.ok).toBe(true);
    if (!publicView.ok) return;

    expect(publicView.data.tagline).toBe('Surgical implants for outpatient centres');
    expect(publicView.data.sizeBand).toBe('51-200');
    expect(publicView.data.foundedYear).toBe(2014);
    expect(publicView.data.industries[0]?.slug).toBe('medical-devices');
    expect(publicView.data.productCategories[0]?.slug).toBe('medical-capital-equipment');

    // Headquarters resolves its ancestry for display.
    expect(publicView.data.headquarters?.name).toBe('Los Angeles Metro');
    expect(publicView.data.headquarters?.ancestors).toContain('California');
  });

  it('the public view omits the legal name', async () => {
    const { org, ownerActor } = await orgWithOwner();
    await updateOrganization(ownerActor, org.id, { legalName: 'Northwind Devices LLC' });

    const publicView = await getOrganizationBySlug(ANONYMOUS, org.slug);
    expect(publicView.ok).toBe(true);
    // Structurally absent, not merely blank: needed for verification and
    // contracts, not for a directory listing.
    if (publicView.ok) expect('legalName' in publicView.data).toBe(false);
  });

  it('rejects a founding year in the future', async () => {
    const { org, ownerActor } = await orgWithOwner();

    const result = await updateOrganization(ownerActor, org.id, {
      foundedYear: new Date().getUTCFullYear() + 5,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('validation');
  });

  it('rejects an unknown headquarters territory rather than dropping it', async () => {
    const { org, ownerActor } = await orgWithOwner();

    const result = await updateOrganization(ownerActor, org.id, {
      hqTerritorySlug: 'atlantis',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
      expect(result.error.fields?.hqTerritorySlug).toContain('atlantis');
    }
  });

  it('rejects an unknown industry slug', async () => {
    const { org, ownerActor } = await orgWithOwner();

    const result = await updateOrganization(ownerActor, org.id, {
      industries: [{ slug: 'not-a-real-industry' }],
    });

    expect(result.ok).toBe(false);
  });

  it('replacing attributes removes the ones no longer selected', async () => {
    const { org, ownerActor } = await orgWithOwner();

    await updateOrganization(ownerActor, org.id, {
      industries: [{ slug: 'medical-devices' }, { slug: 'b2b-saas' }],
    });
    await updateOrganization(ownerActor, org.id, {
      industries: [{ slug: 'b2b-saas' }],
    });

    const view = await getOrganizationBySlug(ANONYMOUS, org.slug);
    expect(view.ok).toBe(true);
    if (view.ok) {
      expect(view.data.industries).toHaveLength(1);
      expect(view.data.industries[0]?.slug).toBe('b2b-saas');
    }
  });

  it('rejects unknown fields, closing mass assignment', async () => {
    const { org, ownerActor } = await orgWithOwner();

    const result = await updateOrganization(ownerActor, org.id, {
      displayName: 'Fine',
      verificationStatus: 'verified',
      status: 'active',
    } as never);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('validation');
  });
});

// ===========================================================================
// Attribute authorization
// ===========================================================================

describe('organisation attribute authorization', () => {
  it('a non-member cannot set attributes', async () => {
    const { org } = await orgWithOwner();
    const outsider = await createUser();

    const result = await updateOrganization(await actorFor(outsider.id), org.id, {
      industries: [{ slug: 'b2b-saas' }],
    });

    expect(result.ok).toBe(false);
  });

  it('a recruiter cannot set attributes — it takes org admin', async () => {
    const { org } = await orgWithOwner();
    const recruiter = await createUser();
    await addMembership(org.id, recruiter.id, 'recruiter');

    const result = await updateOrganization(await actorFor(recruiter.id), org.id, {
      industries: [{ slug: 'b2b-saas' }],
    });

    expect(result.ok).toBe(false);
  });

  it('a direct database write by a non-member is refused', async () => {
    const { org } = await orgWithOwner();
    const outsider = await createUser();
    const outsiderActor = await actorFor(outsider.id);

    let failed = false;
    try {
      await withActor(outsiderActor, async (tx) =>
        tx.execute(sql`
          insert into org_industries (organization_id, industry_id)
          values (${org.id}, (select id from industries where slug = 'b2b-saas'))
        `),
      );
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  it('attributes of a suspended organisation are hidden along with it', async () => {
    const { org, ownerActor } = await orgWithOwner();
    await updateOrganization(ownerActor, org.id, {
      industries: [{ slug: 'b2b-saas' }],
    });

    await db.execute(sql`update organizations set status = 'suspended' where id = ${org.id}`);

    // Attribute policies restate no visibility rules — they ask whether the
    // parent organisation row is visible, so this follows automatically.
    const rows = await withActor(ANONYMOUS, async (tx) =>
      tx.execute(sql`select count(*)::int as n from org_industries where organization_id = ${org.id}`),
    );
    expect((rows as unknown as Array<{ n: number }>)[0]?.n).toBe(0);

    await db.execute(sql`update organizations set status = 'active' where id = ${org.id}`);
  });
});

// ===========================================================================
// Logo integrity
// ===========================================================================

describe('organisation logos', () => {
  it('an org admin can upload and apply a logo', async () => {
    const { org, ownerActor } = await orgWithOwner();

    const uploaded = await uploadFile(ownerActor, {
      bucket: 'logos',
      originalFilename: 'logo.png',
      body: await png(),
      organizationId: org.id,
    });

    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;

    expect((await setOrganizationLogo(ownerActor, org.id, uploaded.data.id)).ok).toBe(true);

    const view = await getOrganizationBySlug(ANONYMOUS, org.slug);
    expect(view.ok && view.data.logoFileId).toBe(uploaded.data.id);
  });

  it('an organisation cannot use another organisation\'s logo file', async () => {
    const first = await orgWithOwner();
    const second = await orgWithOwner();

    const theirLogo = await uploadFile(first.ownerActor, {
      bucket: 'logos',
      originalFilename: 'logo.png',
      body: await png(),
      organizationId: first.org.id,
    });
    if (!theirLogo.ok) throw new Error('upload failed');

    // A database trigger enforces this independently of application code.
    let failed = false;
    try {
      await setOrganizationLogo(second.ownerActor, second.org.id, theirLogo.data.id);
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  it('an organisation cannot use an avatar as its logo', async () => {
    const { org, ownerActor } = await orgWithOwner();

    const avatar = await uploadFile(ownerActor, {
      bucket: 'avatars',
      originalFilename: 'me.png',
      body: await png(),
    });
    if (!avatar.ok) throw new Error('upload failed');

    let failed = false;
    try {
      await setOrganizationLogo(ownerActor, org.id, avatar.data.id);
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  it('a non-admin cannot change the logo', async () => {
    const { org, ownerActor } = await orgWithOwner();
    const recruiter = await createUser();
    await addMembership(org.id, recruiter.id, 'recruiter');

    const uploaded = await uploadFile(ownerActor, {
      bucket: 'logos',
      originalFilename: 'logo.png',
      body: await png(),
      organizationId: org.id,
    });
    if (!uploaded.ok) throw new Error('upload failed');

    const result = await setOrganizationLogo(
      await actorFor(recruiter.id),
      org.id,
      uploaded.data.id,
    );
    expect(result.ok).toBe(false);
  });
});

// ===========================================================================
// Team directory
// ===========================================================================

describe('team listing', () => {
  it('a member sees every colleague, not just themselves', async () => {
    // Regression guard. `users` is readable only by self and admin, so joining
    // it here returned ONLY the caller's own row — a team of four looked like a
    // team of one to every non-admin. Names now come from
    // app.org_member_directory(), which exposes just name and email.
    const { org, owner } = await orgWithOwner();

    const second = await createUser({ fullName: 'Second Person' });
    const third = await createUser({ fullName: 'Third Person' });
    await addMembership(org.id, second.id, 'admin');
    await addMembership(org.id, third.id, 'recruiter');

    const asRecruiter = await listMembers(await actorFor(third.id), org.id);
    expect(asRecruiter.ok).toBe(true);
    if (!asRecruiter.ok) return;

    expect(asRecruiter.data).toHaveLength(3);

    const names = asRecruiter.data.map((m) => m.fullName).sort();
    expect(names).toEqual(['Owner Person', 'Second Person', 'Third Person']);
    // Every row resolved — no 'Unknown' placeholders.
    expect(asRecruiter.data.every((m) => m.email.includes('@'))).toBe(true);

    expect(owner.id).toBeDefined();
  });

  it('a non-member sees not-found, never an empty team', async () => {
    const { org } = await orgWithOwner();
    const outsider = await createUser();

    const result = await listMembers(await actorFor(outsider.id), org.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_found');
  });

  it('the directory function refuses a non-member directly', async () => {
    const { org } = await orgWithOwner();
    const outsider = await createUser();
    const outsiderActor = await actorFor(outsider.id);

    const rows = await withActor(outsiderActor, async (tx) =>
      tx.execute(sql`select count(*)::int as n from app.org_member_directory(${org.id}::uuid)`),
    );
    expect((rows as unknown as Array<{ n: number }>)[0]?.n).toBe(0);
  });
});

// ===========================================================================
// Role management
// ===========================================================================

describe('member role changes', () => {
  it('an owner can change a member\'s role', async () => {
    const { org, ownerActor } = await orgWithOwner();
    const member = await createUser();
    await addMembership(org.id, member.id, 'viewer');

    const result = await updateMemberRole(ownerActor, org.id, member.id, 'recruiter');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.orgRole).toBe('recruiter');
  });

  it('an admin cannot grant a role at or above their own', async () => {
    // Otherwise an admin could mint a peer who is then able to remove them.
    const { org } = await orgWithOwner();
    const admin = await createUser();
    const member = await createUser();
    await addMembership(org.id, admin.id, 'admin');
    await addMembership(org.id, member.id, 'viewer');

    const result = await updateMemberRole(
      await actorFor(admin.id),
      org.id,
      member.id,
      'admin',
    );

    expect(result.ok).toBe(false);
  });

  it('an admin can grant a role below their own', async () => {
    const { org } = await orgWithOwner();
    const admin = await createUser();
    const member = await createUser();
    await addMembership(org.id, admin.id, 'admin');
    await addMembership(org.id, member.id, 'viewer');

    const result = await updateMemberRole(
      await actorFor(admin.id),
      org.id,
      member.id,
      'recruiter',
    );

    expect(result.ok).toBe(true);
  });

  it('a recruiter cannot change roles at all', async () => {
    const { org } = await orgWithOwner();
    const recruiter = await createUser();
    const member = await createUser();
    await addMembership(org.id, recruiter.id, 'recruiter');
    await addMembership(org.id, member.id, 'viewer');

    const result = await updateMemberRole(
      await actorFor(recruiter.id),
      org.id,
      member.id,
      'admin',
    );

    expect(result.ok).toBe(false);
  });

  it('the owner\'s role cannot be changed through this path', async () => {
    const { org, owner, ownerActor } = await orgWithOwner();

    const result = await updateMemberRole(ownerActor, org.id, owner.id, 'viewer');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('conflict');
  });

  it('role changes are audited', async () => {
    const { org, ownerActor } = await orgWithOwner();
    const member = await createUser();
    await addMembership(org.id, member.id, 'viewer');

    await updateMemberRole(ownerActor, org.id, member.id, 'recruiter');

    const rows = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from audit_logs
      where action = 'organization.member_role_changed' and target_id = ${org.id}
    `);
    expect((rows as unknown as Array<{ n: number }>)[0]?.n).toBe(1);
  });

  it('a member can remove themselves, but not a colleague', async () => {
    const { org } = await orgWithOwner();
    const a = await createUser();
    const b = await createUser();
    await addMembership(org.id, a.id, 'recruiter');
    await addMembership(org.id, b.id, 'recruiter');

    expect((await removeMember(await actorFor(a.id), org.id, b.id)).ok).toBe(false);
    expect((await removeMember(await actorFor(a.id), org.id, a.id)).ok).toBe(true);
  });
});

// ===========================================================================
// Slug uniqueness still holds with the richer create path
// ===========================================================================

describe('organisation creation', () => {
  it('a new organisation starts with no profile detail and says so honestly', async () => {
    const user = await createUser();
    const created = await createOrg(await actorFor(user.id), {
      slug: `fresh-${Date.now().toString(36)}`,
      legalName: 'Fresh Ltd',
      displayName: 'Fresh',
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const view = await getOrganizationBySlug(ANONYMOUS, created.data.slug);
    expect(view.ok).toBe(true);
    if (view.ok) {
      expect(view.data.industries).toEqual([]);
      expect(view.data.headquarters).toBeNull();
      expect(view.data.sizeBand).toBeNull();
    }
  });
});
