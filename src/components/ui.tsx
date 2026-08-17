import type { ReactNode } from 'react';

/**
 * Shared primitives.
 *
 * Small and deliberately unopinionated — the point is that every screen gets
 * the same loading, empty and error treatment without each one reinventing it.
 * That consistency is what separates a product from a set of forms.
 */

export function Alert({
  tone,
  children,
}: {
  tone: 'error' | 'success' | 'info' | 'warning';
  children: ReactNode;
}) {
  const styles = {
    error: 'border-red-500/40 bg-red-500/10',
    success: 'border-emerald-500/40 bg-emerald-500/10',
    info: 'border-[var(--border)] bg-[var(--surface)]',
    warning: 'border-amber-500/40 bg-amber-500/10',
  } as const;

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border px-4 py-3 text-sm ${styles[tone]}`}
    >
      {children}
    </div>
  );
}

/**
 * An empty state that explains WHY it is empty and offers the one action that
 * fixes it. "No applications yet" on its own is useless.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-[var(--muted)]">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Skeleton shaped like the content it replaces, never a bare spinner. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-14 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)]"
        />
      ))}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1.5 max-w-xl text-sm text-[var(--muted)]">{description}</p>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </header>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 ${className}`}
    >
      {children}
    </div>
  );
}

export function FieldLabel({
  htmlFor,
  children,
  hint,
}: {
  htmlFor: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {children}
      </label>
      {hint && <p className="mt-0.5 text-xs text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-xs text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm';

export { INPUT_CLASS };

/**
 * Completeness meter.
 *
 * Shows the score AND the highest-value gaps, because "your profile is 45%
 * complete" without saying what is missing is a scolding, not a prompt.
 */
export function CompletenessMeter({
  score,
  missing,
}: {
  score: number;
  missing: Array<{ key: string; label: string; weight: number; hint: string }>;
}) {
  const complete = score >= 100;

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-medium">Profile strength</h2>
        <span className="text-sm tabular-nums text-[var(--muted)]">{score}%</span>
      </div>

      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--border)]"
        role="progressbar"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Profile completeness"
      >
        <div
          className={complete ? 'h-full bg-emerald-500' : 'h-full bg-[var(--color-brand-500)]'}
          style={{ width: `${score}%` }}
        />
      </div>

      {complete ? (
        <p className="mt-3 text-sm text-[var(--muted)]">
          Your profile is complete. Businesses can match you on every attribute.
        </p>
      ) : (
        <div className="mt-4">
          <p className="text-xs text-[var(--muted)]">
            Worth adding next — highest impact first:
          </p>
          <ul className="mt-2 space-y-2">
            {missing.slice(0, 3).map((factor) => (
              <li key={factor.key} className="text-sm">
                <span className="font-medium">{factor.label}</span>{' '}
                <span className="text-xs text-[var(--muted)]">+{factor.weight}%</span>
                <p className="text-xs text-[var(--muted)]">{factor.hint}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
