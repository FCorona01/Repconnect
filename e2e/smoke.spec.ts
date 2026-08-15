import { expect, test } from '@playwright/test';

/**
 * Phase 0 smoke tests.
 *
 * These prove the deployed artifact is genuinely alive — server rendering,
 * routing, security headers, and the dependency health check — rather than
 * that a process is listening on a port.
 *
 * Journey tests (sign up → profile → apply → message) arrive with the features
 * themselves in later phases.
 */

test('health endpoint reports database and RLS status', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);

  const body = (await response.json()) as {
    status: string;
    checks: Record<string, string>;
  };

  expect(body.status).toBe('healthy');
  expect(body.checks.database).toBe('ok');
  // Proves the restricted role exists and cannot bypass RLS. A database
  // missing it would serve every query with security disabled.
  expect(body.checks.rls).toBe('ok');
});

test('home page renders server-side', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'RepConnect' })).toBeVisible();
  await expect(page.getByText('Row Level Security, deny-by-default')).toBeVisible();
});

test('security headers are present', async ({ request }) => {
  const response = await request.get('/');
  const headers = response.headers();

  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  // Next.js advertising its presence is free reconnaissance for an attacker.
  expect(headers['x-powered-by']).toBeUndefined();
});

test('auth pages render and state their status honestly', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  await page.goto('/sign-up');
  await expect(
    page.getByRole('heading', { name: 'Create your account' }),
  ).toBeVisible();
});

test('protected routes redirect anonymous visitors to sign-in', async ({ page }) => {
  // Only meaningful once Supabase is configured; middleware is a no-op before
  // then, because nothing can authenticate.
  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('supabase.co') ||
      process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder'),
    'Requires a real Supabase project',
  );

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard/);
});
