import Link from 'next/link';
import type { Metadata } from 'next';

import { Card, PageHeader } from '@/components/ui';
import { getActor } from '@/lib/auth/session';
import { countTaxonomyEntries } from '@/lib/repositories/taxonomy';

export const metadata: Metadata = { title: 'Admin', robots: { index: false } };

export default async function AdminHomePage() {
  const actor = await getActor();
  const counts = await countTaxonomyEntries(actor);

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
      <PageHeader
        title="Platform administration"
        description="Manage the shared vocabulary every profile and opportunity is described with."
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="text-sm font-medium">Taxonomy</h2>
          {counts.ok ? (
            <dl className="mt-3 space-y-1.5 text-sm text-[var(--muted)]">
              {Object.entries(counts.data).map(([name, count]) => (
                <div key={name} className="flex justify-between gap-4">
                  <dt className="capitalize">{name.replace(/_/g, ' ')}</dt>
                  <dd className="tabular-nums">{count}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">Counts unavailable.</p>
          )}
          <Link
            href="/admin/taxonomy"
            className="mt-4 inline-block text-sm font-medium underline underline-offset-4"
          >
            Manage taxonomy
          </Link>
        </Card>

        <Card>
          <h2 className="text-sm font-medium">Coming in later phases</h2>
          {/* Listed rather than shown as dead buttons: a control that does
              nothing is worse than an absent one. */}
          <ul className="mt-3 space-y-1.5 text-sm text-[var(--muted)]">
            <li>User and company management</li>
            <li>Verification queue (Phase 6)</li>
            <li>Reports and moderation (Phase 6)</li>
            <li>Audit log search (Phase 6)</li>
            <li>Platform analytics (Phase 6)</li>
          </ul>
        </Card>
      </div>
    </main>
  );
}
