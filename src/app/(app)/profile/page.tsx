import Link from 'next/link';
import type { Metadata } from 'next';

import { Alert, PageHeader } from '@/components/ui';
import { getActor } from '@/lib/auth/session';
import {
  listCompensationTypes,
  listCustomerTypes,
  listIndustries,
  listProductCategories,
  listSalesModels,
  listTerritories,
} from '@/lib/repositories/taxonomy';
import { getFileUrl } from '@/lib/repositories/files';
import { getMyRepProfile } from '@/lib/repositories/rep-profiles';

import { ProfileWizard } from './profile-wizard';

export const metadata: Metadata = { title: 'My profile', robots: { index: false } };

/**
 * The rep profile editor.
 *
 * Vocabularies are loaded once on the server and handed to the client as data.
 * They are reference data — public, cacheable, and identical for everyone — so
 * fetching them per keystroke would be wasted round trips.
 */
export default async function ProfilePage() {
  const actor = await getActor();

  const [profile, industries, categories, territories, customerTypes, salesModels, compensation] =
    await Promise.all([
      getMyRepProfile(actor),
      listIndustries(actor, { activeOnly: true }),
      listProductCategories(actor, { activeOnly: true }),
      listTerritories(actor, { activeOnly: true }),
      listCustomerTypes(actor, { activeOnly: true }),
      listSalesModels(actor, { activeOnly: true }),
      listCompensationTypes(actor, { activeOnly: true }),
    ]);

  if (
    !industries.ok ||
    !categories.ok ||
    !territories.ok ||
    !customerTypes.ok ||
    !salesModels.ok ||
    !compensation.ok
  ) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
        <Alert tone="error">
          The taxonomy could not be loaded, so the form cannot be shown. Refresh to try
          again.
        </Alert>
      </main>
    );
  }

  const existing = profile.ok ? profile.data : null;

  const avatar = existing?.avatarFileId
    ? await getFileUrl(actor, existing.avatarFileId)
    : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <PageHeader
        title={existing ? 'Your sales profile' : 'Create your sales profile'}
        description={
          existing
            ? 'Changes save as you go. Your public page updates immediately.'
            : 'Six short steps. Each one saves as you finish it, so you can stop and come back.'
        }
        actions={
          existing ? (
            <Link
              href={`/r/${existing.slug}`}
              className="text-sm font-medium underline underline-offset-4"
            >
              View public page
            </Link>
          ) : undefined
        }
      />

      <div className="mt-8">
        <ProfileWizard
          existing={existing}
          avatarUrl={avatar?.ok ? avatar.data.url : null}
          vocabularies={{
            industries: industries.data,
            productCategories: categories.data,
            territories: territories.data,
            customerTypes: customerTypes.data,
            salesModels: salesModels.data,
            compensationTypes: compensation.data,
          }}
        />
      </div>
    </main>
  );
}
