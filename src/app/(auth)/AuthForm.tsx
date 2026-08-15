'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import type { AuthFormState } from './actions';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-[var(--color-brand-600)] px-4 py-3 text-sm font-medium text-white transition disabled:opacity-60"
    >
      {/* Loading state is not decoration: without it users double-submit. */}
      {pending ? 'Working…' : label}
    </button>
  );
}

function Field({
  name,
  label,
  type = 'text',
  autoComplete,
  error,
  hint,
}: {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  error?: string;
  hint?: string;
}) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') ||
          undefined
        }
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
      />
      {hint && (
        <p id={hintId} className="text-xs text-[var(--muted)]">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

export function AuthForm({
  mode,
  action,
  next,
}: {
  mode: 'sign-in' | 'sign-up';
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  next?: string;
}) {
  const [state, formAction] = useActionState<AuthFormState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {next && <input type="hidden" name="next" value={next} />}

      {state.error && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm"
        >
          {state.error}
        </div>
      )}

      {state.message && (
        <div
          role="status"
          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm"
        >
          {state.message}
        </div>
      )}

      {mode === 'sign-up' && (
        <Field
          name="fullName"
          label="Full name"
          autoComplete="name"
          error={state.fieldErrors?.fullName}
        />
      )}

      <Field
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        error={state.fieldErrors?.email}
      />

      <Field
        name="password"
        label="Password"
        type="password"
        autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
        hint={mode === 'sign-up' ? 'At least 12 characters.' : undefined}
        error={state.fieldErrors?.password}
      />

      <SubmitButton label={mode === 'sign-up' ? 'Create account' : 'Sign in'} />
    </form>
  );
}
