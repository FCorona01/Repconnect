import type { Metadata } from 'next';

import { PageHeader } from '@/components/ui';

import { NewOrganizationForm } from './new-organization-form';

export const metadata: Metadata = { title: 'Create a company', robots: { index: false } };

export default function NewOrganizationPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10 sm:px-8 sm:py-14">
      <PageHeader
        title="Create a company"
        description="You will be its owner. You can add colleagues and fill in the details afterwards."
      />
      <div className="mt-8">
        <NewOrganizationForm />
      </div>
    </main>
  );
}
