'use client';

import { createBrowserClient } from '@supabase/ssr';

import { supabaseEnv } from '@/lib/env';

/**
 * Browser client. Used only for authentication flows (sign-in, sign-up,
 * password reset).
 *
 * It is deliberately never used to read or write application data: the browser
 * does not talk to our database. Every data access goes through server code so
 * that authorization is applied in one auditable place. See docs/01-architecture.md.
 */
export function createSupabaseBrowserClient() {
  const env = supabaseEnv();
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
