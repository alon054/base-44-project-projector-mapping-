import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Two renderer entries, one per window (I-7: preview and output are separate
// render targets). base:'./' so the built HTML loads over file:// in packaged
// Electron.
export default defineConfig({
  root: 'src',
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@shared': resolve(import.meta.dirname, 'electron') },
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        editor: resolve(import.meta.dirname, 'src/editor/index.html'),
        output: resolve(import.meta.dirname, 'src/output/index.html'),
      },
    },
  },
  server: { port: 5173, strictPort: true },
});
