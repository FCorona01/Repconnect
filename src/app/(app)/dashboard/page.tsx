import Link from 'next/link';
import type { Metadata } from 'next';

import { Card, EmptyState, PageHeader } from '@/components/ui';
import { getActor } from '@/lib/auth/session';
import { listMyOrganizations } from '@/lib/repositories/organizations';
import { getMyRepProfile } from '@/lib/repositories/rep-profiles';

export const metadata: Metadata = { title: 'Dashboard', robots: { index: false } };

/**
 * The signed-in landing page.
 *
 * Deliberately reports the true state of both sides rather than showing
 * placeholder tiles: a user with no profile and no company sees exactly that,
 * plus the one action that changes it.
 */
export default async function DashboardPage() {
  const actor = await getActor();

  const [profile, organizations] = await Promise.all([
    getMyRepProfile(actor),
    listMyOrganizations(actor),
  ]);

  const orgs = organizations.ok ? organizations.data : [];

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
      <PageHeader
        title="Dashboard"
        description="Your sales profile and the companies you work with."
      />

      <section className="mt-10">
        <h2 className="text-xs font-semibold tracking-[0.08em] text-[var(--muted)] uppercase">
          Sales profile
        </h2>
        <div className="mt-3">
          {profile.ok ? (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium">{profile.data.headline}</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {profile.data.completeness.score}% complete ·{' '}
                    {profile.data.visibility === 'public'
                      ? 'Visible to anyone'
                      : profile.data.visibility === 'businesses_only'
                        ? 'Visible to businesses'
                        : 'Private'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-3 text-sm">
                  <Link href="/profile" className="font-medium underline underline-offset-4">
                    Edit
                  </Link>
                  <Link
                    href={`/r/${profile.data.slug}`}
                    className="text-[var(--muted)] underline underline-offset-4"
                  >
                    View public page
                  </Link>
                </div>
              </div>
            </Card>
          ) : (
            <EmptyState
              title="You have not created a sales profile yet"
              description="A profile is what businesses search. It also gives you a shareable page you can put on LinkedIn."
              action={
                <Link
                  href="/profile"
                  className="inline-block rounded-lg bg-[var(--color-brand-600)] px-4 py-2.5 text-sm font-medium text-white"
                >
                  Create your profile
                </Link>
              }
            />
          )}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xs font-semibold tracking-[0.08em] text-[var(--muted)] uppercase">
          Companies
        </h2>
        <div className="mt-3">
          {orgs.length > 0 ? (
            <ul className="space-y-3">
              {orgs.map((org) => (
                <li key={org.id}>
                  <Card>
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-medium">{org.displayName}</p>
                        <p className="mt-0.5 text-sm text-[var(--muted)] capitalize">
                          {org.orgRole}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-3 text-sm">
                        <Link
                          href={`/organizations/${org.slug}/settings`}
                          className="font-medium underline underline-offset-4"
                        >
                          Settings
                        </Link>
                        <Link
                          href={`/organizations/${org.slug}/team`}
                          className="text-[var(--muted)] underline underline-offset-4"
                        >
                          Team
                        </Link>
                        <Link
                          href={`/c/${org.slug}`}
                          className="text-[var(--muted)] underline underline-offset-4"
                        >
                          Public page
                        </Link>
                      </div>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="You are not part of any company yet"
              description="Create one to post sales opportunities, or ask a colleague to invite you to theirs."
              action={
                <Link
                  href="/organizations/new"
                  className="inline-block rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-medium"
                >
                  Create a company
                </Link>
              }
            />
          )}
        </div>
      </section>
    </main>
  );
}
