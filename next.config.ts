import type { NextConfig } from 'next';

/**
 * Security headers applied to every response.
 *
 * A Content-Security-Policy with nonces is added in Phase 8, once the set of
 * scripts the app actually loads has stabilised — a CSP written too early is
 * either wrong or so permissive it is decorative.
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Type errors must fail the build. Never set this to true — the whole point
  // of the type system here is that authorization mistakes do not compile.
  // (Next 16 no longer runs ESLint during `next build`; CI runs `pnpm lint`
  // as its own required step instead.)
  typescript: { ignoreBuildErrors: false },

  serverExternalPackages: ['postgres'],

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
