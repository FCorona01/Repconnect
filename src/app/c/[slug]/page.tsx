import { cache } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { getActor } from '@/lib/auth/session';
import { SIZE_BAND_LABELS, type OrgSizeBand } from '@/lib/db/schema';
import { getFileUrl } from '@/lib/repositories/files';
import {
  getOrganizationBySlug,
  type OrganizationProfileView,
} from '@/lib/repositories/organizations';

/**
 * The public company profile.
 *
 * The demand-side counterpart to /r/[slug], and it earns its place for the same
 * cold-start reason: a business can share this page with their own network
 * before RepConnect has any reps browsing, and applications from that traffic
 * still land in RepConnect's pipeline. See docs/07-cold-start.md.
 *
 * Unlike a rep profile, an active company is public by default — businesses
 * want to be found, and nobody's current employer is endangered by it.
 */

const loadOrganization = cache(
  async (slug: string): Promise<OrganizationProfileView | null> => {
    const actor = await getActor();
    const result = await getOrganizationBySlug(actor, slug);
    return result.ok ? result.data : null;
  },
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const org = await loadOrganization(slug);

  if (!org) return { title: 'Company not found', robots: { index: false } };

  const description =
    org.tagline ??
    org.description?.slice(0, 155) ??
    `${org.displayName} is hiring independent sales professionals on RepConnect.`;

  return {
    title: org.displayName,
    description,
    robots: { index: true, follow: true },
    openGraph: { title: org.displayName, description, type: 'website' },
  };
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xs font-semibold tracking-[0.08em] text-[var(--muted)] uppercase">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Tags({ items }: { items: Array<{ id: string; name: string }> }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item.id}>
          <span className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm">
            {item.name}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function CompanyProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const org = await loadOrganization(slug);

  if (!org) notFound();

  const logo = org.logoFileId ? await getFileUrl(await getActor(), org.logoFileId) : null;
  const logoUrl = logo?.ok ? logo.data.url : null;

  const facts = [
    org.sizeBand ? SIZE_BAND_LABELS[org.sizeBand as OrgSizeBand] : null,
    org.foundedYear ? `Founded ${org.foundedYear}` : null,
    org.headquarters
      ? // The immediate parent gives a reader unfamiliar with a metro name
        // enough to place it; the full chain to "Anywhere" is noise.
        [org.headquarters.ancestors.at(-1), org.headquarters.name]
          .filter(Boolean)
          .join(', ')
      : null,
  ].filter((fact): fact is string => Boolean(fact));

  const hasDetail =
    org.industries.length > 0 || org.productCategories.length > 0 || Boolean(org.description);

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-16">
      <article>
        <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-7">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt=""
              width={96}
              height={96}
              className="size-20 shrink-0 rounded-2xl border border-[var(--border)] bg-white object-contain p-2 sm:size-24"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex size-20 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-ink-700)] text-2xl font-semibold text-white sm:size-24 sm:text-3xl"
            >
              {initialsOf(org.displayName)}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                {org.displayName}
              </h1>
              {org.verificationStatus === 'verified' && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  Verified
                </span>
              )}
            </div>

            {org.tagline && (
              <p className="mt-1.5 text-lg text-[var(--muted)]">{org.tagline}</p>
            )}

            {facts.length > 0 && (
              <p className="mt-3 text-sm text-[var(--muted)]">{facts.join(' · ')}</p>
            )}

            {org.website && (
              <a
                href={org.website}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="mt-3 inline-block text-sm font-medium underline underline-offset-4"
              >
                {org.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </a>
            )}
          </div>
        </header>

        {org.description && (
          <Section title="About">
            <p className="text-[15px] leading-relaxed whitespace-pre-line">
              {org.description}
            </p>
          </Section>
        )}

        {org.industries.length > 0 && (
          <Section title="Industries">
            <Tags items={org.industries} />
          </Section>
        )}

        {org.productCategories.length > 0 && (
          <Section title="What they sell">
            <Tags items={org.productCategories} />
          </Section>
        )}

        {!hasDetail && (
          <div className="mt-10 rounded-xl border border-dashed border-[var(--border)] px-5 py-8 text-center">
            <p className="text-sm text-[var(--muted)]">
              This company profile is still being set up.
            </p>
          </div>
        )}

        <footer className="mt-14 border-t border-[var(--border)] pt-6 text-sm text-[var(--muted)]">
          <p>
            Hiring independent sales professionals on{' '}
            <Link href="/" className="font-medium underline underline-offset-4">
              RepConnect
            </Link>
          </p>
        </footer>
      </article>
    </main>
  );
}
