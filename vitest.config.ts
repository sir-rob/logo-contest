import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    globals: true,
    include: [
      'packages/**/*.{test,spec}.ts',
      'apps/api/**/*.{test,spec}.ts',
      // scripts/ holds the seed-data tests. Without this they exist but never
      // run, which is worse than not having them — they read as coverage.
      'scripts/**/*.{test,spec}.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    reporters: ['default'],
  },
  resolve: {
    // fileURLToPath, NOT URL.pathname — the project directory contains spaces
    // and .pathname percent-encodes them, producing a path that resolves to
    // nothing. Same reason vite.config.ts uses fileURLToPath.
    alias: {
      '@contest/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
    },
  },
});
