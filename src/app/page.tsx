import { getActor } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/env';

/**
 * Phase 0 status page.
 *
 * Deliberately not a marketing landing page: there is no product behind it yet,
 * and a page that implies otherwise would be exactly the kind of demo this
 * project set out not to build. It reports what is actually wired up.
 */
export default async function HomePage() {
  const supabaseReady = isSupabaseConfigured();
  const actor = await getActor();

  const phases = [
    { name: 'Project, TypeScript, Tailwind', done: true },
    { name: 'Database schema and migrations', done: true },
    { name: 'Row Level Security, deny-by-default', done: true },
    { name: 'Organisations, members, roles', done: true },
    { name: 'Authorization test matrix', done: true },
    { name: 'Supabase Auth connected', done: supabaseReady },
    { name: 'Taxonomy and profiles (Phase 2)', done: false },
    { name: 'Opportunities (Phase 3)', done: false },
  ];

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium tracking-wide text-[var(--muted)] uppercase">
        Phase 0 · Foundations
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">RepConnect</h1>
      <p className="mt-4 text-lg text-[var(--muted)]">
        A marketplace connecting businesses with independent sales professionals.
        The foundation is in place; the product is being built on top of it.
      </p>

      <ul className="mt-10 space-y-2">
        {phases.map((phase) => (
          <li
            key={phase.name}
            className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
          >
            <span
              aria-hidden="true"
              className={
                phase.done
                  ? 'size-2 shrink-0 rounded-full bg-emerald-500'
                  : 'size-2 shrink-0 rounded-full bg-[var(--color-ink-300)]'
              }
            />
            <span className="text-sm">{phase.name}</span>
            <span className="sr-only">{phase.done ? 'complete' : 'not started'}</span>
          </li>
        ))}
      </ul>

      {!supabaseReady && (
        <div className="mt-8 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <strong className="font-medium">Supabase is not configured yet.</strong>{' '}
          Add your project URL and keys to <code>.env.local</code> — see{' '}
          <code>docs/08-phase-0-setup.md</code>.
        </div>
      )}

      {actor.kind !== 'anonymous' && (
        <p className="mt-8 text-sm text-[var(--muted)]">
          Signed in. Session resolved as <code>{actor.kind}</code>.
        </p>
      )}
    </main>
  );
}
