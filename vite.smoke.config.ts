import { defineConfig } from 'vite';
import { resolve } from 'path';

// Bundles smoke/main.ts (which imports createProofEditor straight from
// src/lib.ts) into a self-contained script for manual/CI browser
// verification. Unlike vite.lib.config.ts this does NOT externalize peer
// deps — it's a throwaway test harness, not the published library artifact.
export default defineConfig({
  root: 'smoke',
  publicDir: false,
  build: {
    outDir: resolve(__dirname, 'smoke-dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'smoke/index.html'),
    },
  },
});
