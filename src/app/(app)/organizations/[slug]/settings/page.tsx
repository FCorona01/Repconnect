import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { Alert, PageHeader } from '@/components/ui';
import { getActor } from '@/lib/auth/session';
import { canEditOrgProfile } from '@/lib/permissions';
import { getFileUrl } from '@/lib/repositories/files';
import { getOrganizationBySlug } from '@/lib/repositories/organizations';
import { listIndustries, listProductCategories, listTerritories } from '@/lib/repositories/taxonomy';

import { OrganizationSettingsForm } from './settings-form';

export const metadata: Metadata = { title: 'Company settings', robots: { index: false } };

export default async function OrganizationSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const actor = await getActor();

  const org = await getOrganizationBySlug(actor, slug);
  if (!org.ok) notFound();

  // Organisations are publicly readable, so being able to LOAD one says nothing
  // about being able to edit it. A non-admin member gets not-found rather than
  // a form that would fail on submit.
  if (!canEditOrgProfile(actor, org.data.id)) notFound();

  const [industries, categories, territories] = await Promise.all([
    listIndustries(actor, { activeOnly: true }),
    listProductCategories(actor, { activeOnly: true }),
    listTerritories(actor, { activeOnly: true }),
  ]);

  if (!industries.ok || !categories.ok || !territories.ok) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
        <Alert tone="error">
          The taxonomy could not be loaded, so the form cannot be shown. Refresh to try
          again.
        </Alert>
      </main>
    );
  }

  const logo = org.data.logoFileId ? await getFileUrl(actor, org.data.logoFileId) : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <PageHeader
        title={org.data.displayName}
        description="How your company appears to sales professionals."
        actions={
          <div className="flex gap-3 text-sm">
            <Link
              href={`/organizations/${slug}/team`}
              className="text-[var(--muted)] underline underline-offset-4"
            >
              Team
            </Link>
            <Link href={`/c/${slug}`} className="font-medium underline underline-offset-4">
              Public page
            </Link>
          </div>
        }
      />

      <div className="mt-8">
        <OrganizationSettingsForm
          slug={slug}
          organization={org.data}
          logoUrl={logo?.ok ? logo.data.url : null}
          vocabularies={{
            industries: industries.data,
            productCategories: categories.data,
            territories: territories.data,
          }}
        />
      </div>
    </main>
  );
}
