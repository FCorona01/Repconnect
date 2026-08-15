import 'server-only';

import { cache } from 'react';

import { ANONYMOUS, type Actor } from '@/lib/auth/actor';
import { isSupabaseConfigured } from '@/lib/env';
import { buildActorForAuthUser, provisionUserFromAuth } from '@/lib/repositories/users';

import { createSupabaseServerClient } from './supabase/server';

/**
 * Resolve the current actor from the request's session.
 *
 * Uses `getUser()`, never `getSession()`. getSession() returns whatever is in
 * the cookie without verifying it; getUser() validates the token against the
 * auth server. A token body is user-supplied data until something
 * authoritative has checked its signature.
 *
 * Wrapped in React's cache() so several Server Components in one render share
 * a single resolution rather than each re-verifying.
 */
export const getActor = cache(async (): Promise<Actor> => {
  if (!isSupabaseConfigured()) return ANONYMOUS;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return ANONYMOUS;

  const actor = await buildActorForAuthUser(user.id);
  if (actor) return actor;

  // Authenticated with Supabase but no domain record yet — first request after
  // signup, or after a signup that failed partway. Provision now so the two
  // systems converge without a separate reconciliation job.
  const provisioned = await provisionUserFromAuth({
    authUserId: user.id,
    email: user.email ?? '',
    fullName:
      (user.user_metadata?.full_name as string | undefined)?.trim() ||
      user.email?.split('@')[0] ||
      'New user',
    emailVerified: Boolean(user.email_confirmed_at),
  });

  if (!provisioned.ok) return ANONYMOUS;

  return (await buildActorForAuthUser(user.id)) ?? ANONYMOUS;
});

/** For pages that require a signed-in user. Returns null rather than throwing. */
export async function getAuthenticatedActor(): Promise<Actor | null> {
  const actor = await getActor();
  return actor.kind === 'user' || actor.kind === 'admin' ? actor : null;
}
