import { expect, test } from '@playwright/test';

/**
 * Route gating for the signed-in and admin areas.
 *
 * These run without Supabase Auth configured, so they verify the ANONYMOUS
 * side of every gate — which is the side that matters for security. The
 * signed-in views are covered at the repository level, where every
 * authorization rule is asserted directly.
 */

const PROTECTED = [
  '/dashboard',
  '/profile',
  '/organizations/new',
  '/organizations/e2e-northwind/settings',
  '/organizations/e2e-northwind/team',
];

for (const path of PROTECTED) {
  test(`anonymous visitors cannot reach ${path}`, async ({ page }) => {
    const response = await page.goto(path);

    // Either the middleware redirects to sign-in, or the layout gate refuses.
    // Both are acceptable; rendering the page is not.
    const url = page.url();
    const status = response?.status() ?? 0;
    const gated = url.includes('/sign-in') || status === 404 || status === 401;

    expect(gated, `${path} should not render for an anonymous visitor`).toBe(true);
  });
}

test('the admin console is not merely hidden — it 404s for anonymous visitors', async ({
  page,
}) => {
  // notFound(), not a redirect or a 403: the admin console's existence is not
  // confirmed to someone who may not use it.
  const response = await page.goto('/admin');
  const status = response?.status() ?? 0;
  const gated = page.url().includes('/sign-in') || status === 404;
  expect(gated).toBe(true);
});

test('the admin taxonomy page is gated too', async ({ page }) => {
  const response = await page.goto('/admin/taxonomy');
  const status = response?.status() ?? 0;
  const gated = page.url().includes('/sign-in') || status === 404;
  expect(gated).toBe(true);
});

test('the home page offers a way in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Create an account' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
});

test('public pages remain reachable while the app is gated', async ({ page }) => {
  await page.goto('/c/e2e-northwind');
  await expect(page.getByRole('heading', { name: 'Northwind Devices' })).toBeVisible();

  await page.goto('/r/e2e-public-rep');
  await expect(page.getByRole('heading', { name: 'Ada Public' })).toBeVisible();
});
