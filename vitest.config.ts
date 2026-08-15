import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup/env.ts'],
    // Integration tests share one database. Running files sequentially keeps
    // them isolated without needing a schema per worker.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` throws when imported outside a React Server Component.
      // Tests exercise these modules directly, so it is stubbed out.
      'server-only': fileURLToPath(
        new URL('./tests/setup/server-only-stub.ts', import.meta.url),
      ),
    },
  },
});
