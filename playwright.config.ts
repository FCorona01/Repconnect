import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

/**
 * Some CI images ship a Chromium build that does not match the revision this
 * Playwright version would download. PLAYWRIGHT_CHROMIUM_EXECUTABLE lets those
 * environments point at the browser they already have instead of fetching
 * another copy. Unset locally, where `playwright install` has run normally.
 */
const launchOptions = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
  : {};

/**
 * E2E runs against a real build and a real database.
 *
 * Mobile viewport is a first-class project, not an afterthought: sales reps
 * are by definition not at a desk, so a mobile regression must fail CI rather
 * than be found by a user.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], launchOptions },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], launchOptions },
    },
  ],

  webServer: {
    command: `pnpm exec next start --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
