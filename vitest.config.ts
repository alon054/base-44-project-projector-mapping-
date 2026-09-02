import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// SPEC.md §8.1: pure logic only, no GPU, no DOM.
// `electron` is aliased to a stub because `config.ts` imports it for path
// lookup while the logic under test is pure.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'electron'),
      electron: resolve(import.meta.dirname, 'src/test/electron-stub.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/test/**/*.test.ts'],
  },
});
