/**
 * Web test runner — SEPARATE from the root config on purpose.
 *
 * The root `vitest.config.ts` runs the backend suites (`packages/**`,
 * `apps/api/**`, `scripts/**`) in the default node environment and does not
 * include `apps/web` at all. Component tests need `jsdom`, a React transform
 * and the `@` alias, none of which the backend wants — so they get their own
 * project rather than a shared config with conditional environments.
 *
 *   backend:  npx vitest run                      (from the repo root)
 *   web:      npx vitest run -c apps/web/vitest.config.ts
 *
 * The two never overlap: root includes only `*.{test,spec}.ts` under
 * packages/api/scripts, this one only files under `apps/web/src`.
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // fileURLToPath, NOT URL.pathname — the project directory contains spaces
    // and .pathname percent-encodes them into a path that resolves to nothing.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@contest/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  // Pinned so `include` means the same thing whether the command is run from
  // the repo root or from `apps/web`. Without it, vitest roots at cwd and the
  // relative include silently matches nothing.
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [fileURLToPath(new URL('./src/__tests__/setup.ts', import.meta.url))],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    restoreMocks: true,
    reporters: ['default'],
  },
});
