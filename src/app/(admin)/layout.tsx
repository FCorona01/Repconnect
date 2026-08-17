import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui';
import { isAdmin } from '@/lib/auth/actor';
import { getActor } from '@/lib/auth/session';

/**
 * The admin gate.
 *
 * Runs once for every page under this route group, so an admin page added later
 * inherits it by default. Three things make this hard to get around:
 *
 *   - the platform role is read from OUR database, never from a token claim a
 *     client could influence
 *   - a non-admin gets notFound(), not a redirect or a 403 — the admin console's
 *     existence is not confirmed to someone who may not use it
 *   - the role itself cannot be self-granted: there is no code path that writes
 *     platform_role except a superadmin action and scripts/promote-admin.ts
 *
 * Repository-level admin checks and RLS still apply independently. This gate is
 * routing, not the security boundary.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();

  if (!isAdmin(actor)) notFound();

  return (
    <div className="min-h-dvh">
      <header className="border-b border-amber-500/40 bg-amber-500/5">
        <nav
          aria-label="Admin"
          className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3.5 sm:px-8"
        >
          <Link href="/admin" className="text-sm font-semibold">
            RepConnect admin
          </Link>
          <Link href="/admin/taxonomy" className="text-sm text-[var(--muted)]">
            Taxonomy
          </Link>
          <Link href="/dashboard" className="ml-auto text-sm text-[var(--muted)] underline">
            Back to app
          </Link>
        </nav>
      </header>

      <div className="mx-auto w-full max-w-4xl px-5 pt-6 sm:px-8">
        {/* Stated rather than silently missing: docs/03-security.md requires MFA
            for admin sessions, and there is no way to enrol one yet. */}
        <Alert tone="warning">
          Multi-factor authentication is not enforced for admin accounts yet. It arrives
          with the verification work in Phase 6.
        </Alert>
      </div>

      {children}
    </div>
  );
}
