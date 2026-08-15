import { cache } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { getActor } from '@/lib/auth/session';
import { SENIORITY_LABELS, type RepSeniority } from '@/lib/db/schema';
import { getFileUrl } from '@/lib/repositories/files';
import { getRepProfileBySlug, type RepProfilePublicView } from '@/lib/repositories/rep-profiles';

import { AttributeList, ProfileSection, TerritoryList } from './sections';

/**
 * The public rep profile.
 *
 * This is not a settings screen with a different stylesheet. For a marketplace
 * starting with no users on either side, it is the acquisition mechanism: a
 * professional credential a rep is willing to put in an email signature and on
 * LinkedIn, which is valuable to them even when zero businesses are here yet.
 * See docs/07-cold-start.md.
 *
 * Access is decided by the profile's visibility setting, enforced in the
 * database. A profile the viewer may not see returns 404 rather than 403 —
 * "this person exists but you may not look" is itself the leak for a rep whose
 * current employer must not find out they are looking.
 */

// Deduped so generateMetadata and the page body share one query per request.
const loadProfile = cache(
  async (slug: string): Promise<RepProfilePublicView | null> => {
    const actor = await getActor();
    const result = await getRepProfileBySlug(actor, slug);
    return result.ok ? result.data : null;
  },
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const profile = await loadProfile(slug);

  if (!profile) return { title: 'Profile not found', robots: { index: false } };

  const title = `${profile.fullName} — ${profile.headline}`;
  const description =
    profile.bio?.slice(0, 155) ??
    `${profile.fullName} is an independent sales professional on RepConnect.`;

  return {
    title,
    description,
    // Indexing is OPT-IN, never opt-out. Many reps have a current employer, and
    // a profile that quietly appears in Google would be a serious problem for
    // them — and would suppress signup on the scarce side of the marketplace.
    robots:
      profile.visibility === 'public'
        ? { index: true, follow: true }
        : { index: false, follow: false },
    openGraph: {
      title,
      description,
      type: 'profile',
    },
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

function experienceSummary(profile: RepProfilePublicView): string | null {
  const parts: string[] = [];

  if (profile.seniority) {
    parts.push(SENIORITY_LABELS[profile.seniority as RepSeniority]);
  }
  if (profile.yearsExperience !== null) {
    parts.push(
      `${profile.yearsExperience} ${profile.yearsExperience === 1 ? 'year' : 'years'} selling`,
    );
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

export default async function RepProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const profile = await loadProfile(slug);

  if (!profile) notFound();

  const experience = experienceSummary(profile);
  const isVerified = profile.verificationStatus === 'verified';

  // Issued per request, after an authorization check on the files row, and
  // never cached — a cached authorization-dependent URL is a public URL.
  const avatar = profile.avatarFileId
    ? await getFileUrl(await getActor(), profile.avatarFileId)
    : null;
  const avatarUrl = avatar?.ok ? avatar.data.url : null;

  const hasAnyExpertise =
    profile.industries.length > 0 ||
    profile.productCategories.length > 0 ||
    profile.territories.length > 0 ||
    profile.customerTypes.length > 0 ||
    profile.salesModels.length > 0;

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-16">
      <article>
        {/* --- Identity -------------------------------------------------- */}
        <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-7">
          {avatarUrl ? (
            // Dimensions come from the files row, recorded at upload time, so
            // the space is reserved before the image loads and the page does
            // not jump. eslint's next/image rule is waived deliberately: the
            // URL is short-lived and authorization-dependent, which the image
            // optimiser would cache and thereby defeat.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt=""
              width={96}
              height={96}
              className="size-20 shrink-0 rounded-2xl object-cover sm:size-24"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex size-20 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-brand-600)] text-2xl font-semibold text-white sm:size-24 sm:text-3xl"
            >
              {initialsOf(profile.fullName)}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                {profile.fullName}
              </h1>
              {isVerified && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor" aria-hidden="true">
                    <path d="M8 0l1.9 1.3 2.3-.3 1 2.1 2.1 1-.3 2.3L16 8l-1.3 1.9.3 2.3-2.1 1-1 2.1-2.3-.3L8 16l-1.9-1.3-2.3.3-1-2.1-2.1-1 .3-2.3L0 8l1.3-1.9-.3-2.3 2.1-1 1-2.1 2.3.3L8 0zm3.6 5.6l-1.1-1.1-3.3 3.3-1.7-1.7-1.1 1.1L7.2 10l4.4-4.4z" />
                  </svg>
                  Verified
                </span>
              )}
            </div>

            <p className="mt-1.5 text-lg text-[var(--muted)]">{profile.headline}</p>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[var(--muted)]">
              {experience && <span>{experience}</span>}
              {profile.openToWork && (
                <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" />
                  Open to opportunities
                </span>
              )}
              {profile.availabilityHoursPerWeek !== null && (
                <span>{profile.availabilityHoursPerWeek} hrs/week available</span>
              )}
            </div>

            {profile.linkedinUrl && (
              <a
                href={profile.linkedinUrl}
                target="_blank"
                // noopener/noreferrer: a user-supplied outbound link must not be
                // able to reach back into this page via window.opener.
                rel="noopener noreferrer nofollow"
                className="mt-3 inline-block text-sm font-medium underline underline-offset-4"
              >
                LinkedIn
              </a>
            )}
          </div>
        </header>

        {/* --- About ------------------------------------------------------ */}
        {profile.bio && (
          <ProfileSection title="About">
            <p className="text-[15px] leading-relaxed whitespace-pre-line">{profile.bio}</p>
          </ProfileSection>
        )}

        {/* --- What they sell --------------------------------------------- */}
        {profile.industries.length > 0 && (
          <ProfileSection title="Industries">
            <AttributeList items={profile.industries} showProficiency />
          </ProfileSection>
        )}

        {profile.productCategories.length > 0 && (
          <ProfileSection title="What they sell">
            <AttributeList items={profile.productCategories} showProficiency />
          </ProfileSection>
        )}

        {/* --- Where ------------------------------------------------------ */}
        {profile.territories.length > 0 && (
          <ProfileSection title="Territories">
            <TerritoryList items={profile.territories} />
          </ProfileSection>
        )}

        {/* --- Who and how ------------------------------------------------ */}
        {profile.customerTypes.length > 0 && (
          <ProfileSection title="Sells to">
            <AttributeList items={profile.customerTypes} showProficiency />
          </ProfileSection>
        )}

        {profile.salesModels.length > 0 && (
          <ProfileSection title="How they sell">
            <AttributeList items={profile.salesModels} showProficiency />
          </ProfileSection>
        )}

        {profile.compensationTypes.length > 0 && (
          <ProfileSection title="Open to">
            <AttributeList items={profile.compensationTypes} />
          </ProfileSection>
        )}

        {/* Empty state. A profile with nothing on it is a real thing a viewer
            can land on — say so plainly rather than rendering a bare page. */}
        {!hasAnyExpertise && !profile.bio && (
          <div className="mt-10 rounded-xl border border-dashed border-[var(--border)] px-5 py-8 text-center">
            <p className="text-sm text-[var(--muted)]">
              This profile is still being set up.
            </p>
          </div>
        )}

        <footer className="mt-14 border-t border-[var(--border)] pt-6 text-sm text-[var(--muted)]">
          <p>
            Independent sales professional on{' '}
            <Link href="/" className="font-medium underline underline-offset-4">
              RepConnect
            </Link>
          </p>
        </footer>
      </article>
    </main>
  );
}
