import { expect, test } from '@playwright/test';

/**
 * The public rep profile is the cold-start acquisition surface: a credential a
 * rep shares before RepConnect has any businesses on it. These check it renders
 * server-side, respects visibility, and does not get indexed unless the rep
 * opted in.
 *
 * Fixtures are seeded by e2e/global-setup.ts against the same local database
 * the integration tests use.
 */

test('a public profile renders server-side for an anonymous visitor', async ({ page }) => {
  const response = await page.goto('/r/e2e-public-rep');
  expect(response?.status()).toBe(200);

  await expect(page.getByRole('heading', { name: 'Ada Public' })).toBeVisible();
  await expect(page.getByText('Enterprise MedTech closer')).toBeVisible();

  // Attributes render from the taxonomy, with territory ancestry for context.
  await expect(page.getByText('Medical Devices')).toBeVisible();
  await expect(page.getByText('California')).toBeVisible();
  await expect(page.getByText('Open to opportunities')).toBeVisible();
});

test('a public profile is indexable, and its content is in the HTML', async ({ request }) => {
  const response = await request.get('/r/e2e-public-rep');
  const html = await response.text();

  // Server-rendered: a crawler sees the content, not an empty div.
  expect(html).toContain('Ada Public');
  expect(html).toContain('Enterprise MedTech closer');
  expect(html).not.toMatch(/<meta name="robots"[^>]*noindex/i);
});

test('a businesses-only profile is hidden from anonymous visitors', async ({ page }) => {
  const response = await page.goto('/r/e2e-private-rep');

  // 404, not 403 — a rep with a current employer must not have their presence
  // on RepConnect confirmed to an anonymous visitor.
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();
});

test('a hidden profile is never indexed', async ({ request }) => {
  const response = await request.get('/r/e2e-private-rep');
  const html = await response.text();

  expect(html).toMatch(/noindex/i);
  expect(html).not.toContain('Bob Private');
});

test('the avatar loads through the authorized route', async ({ page, request }) => {
  await page.goto('/r/e2e-public-rep');

  const avatar = page.locator('img[src*="/api/files/"]');
  await expect(avatar).toBeVisible();

  const src = await avatar.getAttribute('src');
  expect(src).toBeTruthy();

  // Served with the headers that stop an uploaded file executing in our origin
  // or being cached by a shared cache.
  const response = await request.get(src!);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('image/webp');
  expect(response.headers()['content-disposition']).toContain('attachment');
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
});

test('a file cannot be fetched by guessing an id', async ({ request }) => {
  const response = await request.get('/api/files/01890000-0000-7000-8000-000000000000');
  expect(response.status()).toBe(404);
});

test('an unknown slug returns the same not-found page', async ({ page }) => {
  const response = await page.goto('/r/no-such-rep-at-all');
  expect(response?.status()).toBe(404);
});

test('the profile is readable on a phone', async ({ page }) => {
  await page.goto('/r/e2e-public-rep');

  await expect(page.getByRole('heading', { name: 'Ada Public' })).toBeVisible();

  // The page body must never scroll sideways — the most common mobile defect.
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows).toBe(false);
});
