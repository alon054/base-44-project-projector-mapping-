import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * The preload runs with `sandbox: true`, where `require()` is limited to
 * `electron` and a few polyfilled built-ins — a relative `require('./ipc')`
 * fails at load, which silently leaves `window.engine` undefined. So the preload
 * is bundled into one self-contained CJS file.
 */
export default defineConfig({
  build: {
    outDir: resolve(import.meta.dirname, 'dist-electron'),
    emptyOutDir: false,
    minify: false,
    target: 'node22',
    lib: {
      entry: resolve(import.meta.dirname, 'electron/preload.ts'),
      formats: ['cjs'],
      fileName: () => 'preload.js',
    },
    rollupOptions: { external: ['electron'] },
  },
});
