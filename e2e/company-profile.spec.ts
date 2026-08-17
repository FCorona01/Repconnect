import { expect, test } from '@playwright/test';

/**
 * The public company profile — the demand-side counterpart to /r/[slug].
 *
 * Unlike a rep profile, an active company is public by default: businesses want
 * to be found, and no one's current employer is endangered by it.
 */

test('a company profile renders server-side for an anonymous visitor', async ({ page }) => {
  const response = await page.goto('/c/e2e-northwind');
  expect(response?.status()).toBe(200);

  await expect(page.getByRole('heading', { name: 'Northwind Devices' })).toBeVisible();
  await expect(page.getByText('Surgical implants for outpatient centres')).toBeVisible();
  await expect(page.getByText('Verified')).toBeVisible();

  // Facts line: size, founding year, and headquarters with its parent for context.
  await expect(page.getByText(/51–200 employees/)).toBeVisible();
  await expect(page.getByText(/Founded 2014/)).toBeVisible();
  await expect(page.getByText(/California, Los Angeles Metro/)).toBeVisible();

  await expect(page.getByText('Medical Devices')).toBeVisible();
});

test('a company profile is indexable and its content is in the HTML', async ({ request }) => {
  const response = await request.get('/c/e2e-northwind');
  const html = await response.text();

  expect(html).toContain('Northwind Devices');
  expect(html).not.toMatch(/<meta name="robots"[^>]*noindex/i);
});

test('the legal name is never published', async ({ request }) => {
  // Needed for verification and contracts, not for a directory listing —
  // publishing it invites confusion with the trading name people recognise.
  const response = await request.get('/c/e2e-northwind');
  const html = await response.text();

  expect(html).not.toContain('Northwind Devices LLC');
});

test('an unknown company slug returns not-found', async ({ page }) => {
  const response = await page.goto('/c/no-such-company');
  expect(response?.status()).toBe(404);
});

test('the team page is not reachable without signing in', async ({ page }) => {
  const response = await page.goto('/organizations/e2e-northwind/team');

  // Middleware redirects to sign-in; the repository would refuse regardless.
  await expect(page).toHaveURL(/\/sign-in|\/organizations/);
  expect(response?.status()).toBeLessThan(500);
});

test('the company profile is readable on a phone', async ({ page }) => {
  await page.goto('/c/e2e-northwind');
  await expect(page.getByRole('heading', { name: 'Northwind Devices' })).toBeVisible();

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows).toBe(false);
});
