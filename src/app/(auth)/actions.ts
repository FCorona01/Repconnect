'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createSupabaseServerClient } from '@/lib/auth/supabase/server';
import { provisionUserFromAuth } from '@/lib/repositories/users';

/**
 * Authentication Server Actions.
 *
 * Every action follows the same order: validate, act, translate the outcome
 * into a value the UI must handle. Errors are returned, not thrown — an
 * incorrect password is an expected outcome, not an exception.
 */

export interface AuthFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  message?: string;
}

const signUpSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter your name').max(120),
  email: z.email('Enter a valid email address').transform((e) => e.toLowerCase()),
  password: z
    .string()
    // Length over composition rules, following current NIST guidance.
    // Supabase additionally checks against known-breached password lists.
    .min(12, 'Use at least 12 characters')
    .max(200),
});

const signInSchema = z.object({
  email: z.email('Enter a valid email address').transform((e) => e.toLowerCase()),
  password: z.string().min(1, 'Enter your password'),
});

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  return Object.fromEntries(
    error.issues.map((i) => [String(i.path[0] ?? '_'), i.message]),
  );
}

export async function signUpAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.fullName } },
  });

  if (error) {
    // Deliberately generic: a message distinguishing "already registered" from
    // other failures lets an attacker enumerate which emails have accounts.
    return {
      error: 'We could not create that account. Check the details and try again.',
    };
  }

  if (data.user) {
    const provisioned = await provisionUserFromAuth({
      authUserId: data.user.id,
      email: parsed.data.email,
      fullName: parsed.data.fullName,
      emailVerified: Boolean(data.user.email_confirmed_at),
    });

    if (!provisioned.ok) {
      return { error: provisioned.error.message };
    }
  }

  return {
    message:
      'Check your email for a confirmation link. You need to confirm before signing in.',
  };
}

export async function signInAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Identical response whether the email exists or the password was wrong.
    return { error: 'Those details do not match an account.' };
  }

  const next = formData.get('next');
  redirect(typeof next === 'string' && next.startsWith('/') ? next : '/');
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  // Revokes server-side rather than only clearing the cookie.
  await supabase.auth.signOut();
  redirect('/');
}
