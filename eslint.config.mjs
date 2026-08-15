import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

/**
 * Flat config. eslint-config-next 16 exports flat config arrays directly, so
 * no FlatCompat shim is needed. The TypeScript config must be included
 * explicitly — it carries the @typescript-eslint plugin the rules below use.
 */
const config = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'drizzle/_generated/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Structural guard: user-facing route groups must not import admin-scoped
    // repository functions. Enforced by the build, not by memory.
    files: [
      'src/app/(rep)/**',
      'src/app/(business)/**',
      'src/app/(marketing)/**',
      'src/app/(auth)/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/lib/repositories/admin/*', '**/repositories/admin/*'],
              message:
                'Admin repositories must not be imported into user-facing routes.',
            },
          ],
        },
      ],
    },
  },
];

export default config;
