import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { getActor } from '@/lib/auth/session';
import { ORG_ROLE_RANK, type OrgRole } from '@/lib/db/schema';
import { canManageOrgMembers } from '@/lib/permissions';
import { getOrganizationBySlug, listMembers } from '@/lib/repositories/organizations';

import { InviteMemberForm, MemberRow } from './team-client';

export const metadata: Metadata = { title: 'Team', robots: { index: false } };

const ROLE_DESCRIPTIONS: Record<OrgRole, string> = {
  owner: 'Full control, including billing and ownership',
  admin: 'Manage the company profile and the team',
  recruiter: 'Post opportunities and review applicants',
  viewer: 'Read-only access',
};

export default async function TeamPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const actor = await getActor();

  const org = await getOrganizationBySlug(actor, slug);
  if (!org.ok) notFound();

  // Non-members get not-found rather than an empty team list. The repository
  // enforces this too; checking here avoids rendering a shell around nothing.
  const members = await listMembers(actor, org.data.id);
  if (!members.ok) notFound();

  const canManage = canManageOrgMembers(actor, org.data.id);
  const myRank =
    actor.kind === 'user' || actor.kind === 'admin'
      ? (actor.memberships.find((m) => m.organizationId === org.data.id)?.orgRole ?? null)
      : null;

  const pending = members.data.filter((m) => m.acceptedAt === null);
  const active = members.data.filter((m) => m.acceptedAt !== null);

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <nav className="text-sm text-[var(--muted)]">
        <Link href={`/c/${org.data.slug}`} className="underline underline-offset-4">
          {org.data.displayName}
        </Link>
      </nav>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Team</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        People who can act for {org.data.displayName}. Roles decide what each of them
        can do.
      </p>

      {canManage && <InviteMemberForm slug={slug} />}

      <section className="mt-10">
        <h2 className="text-xs font-semibold tracking-[0.08em] text-[var(--muted)] uppercase">
          Members ({active.length})
        </h2>
        <ul className="mt-3 divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          {active.map((member) => (
            <MemberRow
              key={member.userId}
              slug={slug}
              member={member}
              roleDescription={ROLE_DESCRIPTIONS[member.orgRole]}
              // An admin may only grant roles below their own, so the controls
              // reflect exactly what the server will accept — rather than
              // offering an option that fails on submit.
              canManage={
                canManage &&
                member.orgRole !== 'owner' &&
                (myRank === null || ORG_ROLE_RANK[member.orgRole] < ORG_ROLE_RANK[myRank])
              }
              maxGrantableRank={myRank ? ORG_ROLE_RANK[myRank] : 0}
            />
          ))}
        </ul>
      </section>

      {pending.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-semibold tracking-[0.08em] text-[var(--muted)] uppercase">
            Pending invitations ({pending.length})
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            A pending invitation grants no access until it is accepted.
          </p>
          <ul className="mt-3 divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            {pending.map((member) => (
              <MemberRow
                key={member.userId}
                slug={slug}
                member={member}
                roleDescription={ROLE_DESCRIPTIONS[member.orgRole]}
                canManage={canManage}
                maxGrantableRank={myRank ? ORG_ROLE_RANK[myRank] : 0}
                pending
              />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
