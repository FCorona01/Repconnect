import type { Metadata } from 'next';

import { Alert, PageHeader } from '@/components/ui';
import { getActor } from '@/lib/auth/session';
import { listIndustries, listProductCategories } from '@/lib/repositories/taxonomy';

import { TaxonomyManager } from './taxonomy-manager';

export const metadata: Metadata = { title: 'Taxonomy', robots: { index: false } };

export default async function AdminTaxonomyPage() {
  const actor = await getActor();

  const [industries, categories] = await Promise.all([
    listIndustries(actor),
    listProductCategories(actor),
  ]);

  if (!industries.ok || !categories.ok) {
    return (
      <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8">
        <Alert tone="error">The taxonomy could not be loaded.</Alert>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
      <PageHeader
        title="Taxonomy"
        description="The shared vocabulary both sides describe the world with. Adding to it is safe at any time; slugs are permanent and entries are retired rather than deleted."
      />

      <div className="mt-8 space-y-12">
        <TaxonomyManager
          taxonomy="industries"
          title="Industries"
          nodes={industries.data}
        />
        <TaxonomyManager
          taxonomy="product-categories"
          title="Product categories"
          nodes={categories.data}
        />
      </div>
    </main>
  );
}
