import Link from 'next/link';
import { redirect } from 'next/navigation';

import { signOutAction } from '@/app/(auth)/actions';
import { getActor } from '@/lib/auth/session';
import { isAdmin } from '@/lib/auth/actor';

/**
 * The signed-in shell.
 *
 * The authorization gate runs ONCE here, so any page added under this route
 * group inherits it by default — secure unless someone deliberately puts a page
 * elsewhere. This is the first of the three walls in docs/03-security.md; the
 * repository layer and RLS still enforce everything independently, so a bug
 * here is a routing bug, not a data breach.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();

  if (actor.kind === 'anonymous' || actor.kind === 'system') {
    redirect('/sign-in');
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-[var(--border)]">
        <nav
          aria-label="Main"
          className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3.5 sm:px-8"
        >
          <Link href="/dashboard" className="text-sm font-semibold">
            RepConnect
          </Link>
          <Link href="/profile" className="text-sm text-[var(--muted)]">
            My profile
          </Link>
          <Link href="/dashboard" className="text-sm text-[var(--muted)]">
            Companies
          </Link>
          {isAdmin(actor) && (
            <Link href="/admin" className="text-sm text-[var(--muted)]">
              Admin
            </Link>
          )}
          <form action={signOutAction} className="ml-auto">
            <button type="submit" className="text-sm text-[var(--muted)] underline">
              Sign out
            </button>
          </form>
        </nav>
      </header>
      {children}
    </div>
  );
}
