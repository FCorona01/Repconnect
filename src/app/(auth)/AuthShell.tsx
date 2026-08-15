import Link from 'next/link';

import { isSupabaseConfigured } from '@/lib/env';

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const ready = isSupabaseConfigured();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-12">
      <Link href="/" className="text-sm text-[var(--muted)]">
        ← RepConnect
      </Link>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-2 text-sm text-[var(--muted)]">{subtitle}</p>}

      <div className="mt-8">
        {ready ? (
          children
        ) : (
          /* Honest empty state. A form that cannot possibly work is worse than
             none: it fails silently and looks like a bug in the product. */
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            <p className="font-medium">Authentication is not connected yet.</p>
            <p className="mt-1 text-[var(--muted)]">
              Add your Supabase project URL and anon key to <code>.env.local</code>,
              then restart. See <code>docs/08-phase-0-setup.md</code>.
            </p>
          </div>
        )}
      </div>

      {footer && <p className="mt-6 text-sm text-[var(--muted)]">{footer}</p>}
    </main>
  );
}
