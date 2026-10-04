import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * One-off build for the accent comparison page.
 *
 * Separate from `vite.config.ts` so the gallery never ships inside the app
 * bundle. `base: './'` matters: the output is opened directly off disk to take
 * a screenshot, and absolute `/assets/...` URLs do not resolve from `file://`.
 *
 * fileURLToPath, never `URL.pathname` — the project directory contains spaces,
 * and `.pathname` percent-encodes them into a path that resolves to nothing.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@contest/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  build: {
    outDir: 'dist-gallery',
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./style-gallery.html', import.meta.url)),
    },
  },
});
