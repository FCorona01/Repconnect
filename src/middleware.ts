import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refreshes the Supabase session cookie and applies coarse route gating.
 *
 * This is the FIRST of three walls, and the weakest by design: it exists to
 * give users a clean redirect rather than to protect data. Real authorization
 * happens in the repository layer and again in Row Level Security. Middleware
 * must never be the only thing standing between a user and a record.
 */

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/profile',
  '/settings',
  '/organizations',
] as const;
const ADMIN_PREFIX = '/admin';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Before Supabase is configured the app still runs; nothing is protected
  // because nothing can authenticate.
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() validates the token with the auth server. Do not replace this
  // with getSession(), which trusts the cookie's contents unverified.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const needsAuth =
    PROTECTED_PREFIXES.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith(ADMIN_PREFIX);

  if (needsAuth && !user) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = '/sign-in';
    signIn.searchParams.set('next', pathname);
    return NextResponse.redirect(signIn);
  }

  // Note: admin *authorization* is not decided here. The platform role lives in
  // our database, not in the auth token, so the (admin) layout performs the
  // real check. This only ensures an anonymous visitor is redirected to sign in.

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files — those never need a
     * session and matching them wastes an auth round trip per request.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
