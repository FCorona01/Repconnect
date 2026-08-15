/**
 * Result type for operations that can fail in expected ways.
 *
 * Expected failures ("already a member", "slug taken") are values, not thrown
 * exceptions. Returning a discriminated union forces the caller — and the UI —
 * to handle both branches, because the type system will not let them ignore it.
 *
 * Genuinely unexpected failures still throw, are caught by an error boundary,
 * and are reported to Sentry.
 */
export type Result<T, E extends AppError = AppError> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(data: T): { readonly ok: true; readonly data: T } {
  return { ok: true, data };
}

export function err<E extends AppError>(
  error: E,
): { readonly ok: false; readonly error: E } {
  return { ok: false, error };
}

export type AppErrorCode =
  | 'not_found'
  | 'forbidden'
  | 'unauthenticated'
  | 'validation'
  | 'conflict'
  | 'rate_limited';

export interface AppError {
  readonly code: AppErrorCode;
  readonly message: string;
  /** Field-level messages, keyed by form field name. */
  readonly fields?: Readonly<Record<string, string>>;
}

/**
 * Deliberately identical to notFound().
 *
 * Telling an attacker "that record exists but you may not touch it" confirms
 * the record's existence, which is itself a leak. A caller that is not
 * permitted to see something is told it does not exist.
 */
export function forbidden(message = 'Not found'): AppError {
  return { code: 'not_found', message };
}

export function notFound(message = 'Not found'): AppError {
  return { code: 'not_found', message };
}

export function unauthenticated(message = 'You need to sign in'): AppError {
  return { code: 'unauthenticated', message };
}

export function conflict(message: string): AppError {
  return { code: 'conflict', message };
}

export function validation(
  message: string,
  fields?: Record<string, string>,
): AppError {
  return { code: 'validation', message, ...(fields ? { fields } : {}) };
}

/**
 * Thrown when application code reaches a state that should be impossible —
 * a genuine bug rather than a user-facing outcome.
 */
export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvariantError';
  }
}

export function invariant(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new InvariantError(message);
}
