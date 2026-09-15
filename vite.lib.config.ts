import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// @sjawhar/proof-editor library build: bundles src/lib.ts (browser) and
// src/lib-headless.ts (Node/Bun) as ES modules a host (e.g. Dispatch) can
// import directly. Milkdown/ProseMirror/Yjs and the headless entry's own
// markdown-processing stack (unified/remark-*) are peer dependencies, kept
// external so a host dedupes against its own copies instead of bundling a
// second one.
export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: 'tsconfig.lib.json',
      entryRoot: 'src',
      include: ['src/**/*.ts'],
      exclude: ['src/tests/**', 'src/editor/schema/remark-frontmatter-plugin.ts'],
    }),
  ],
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: {
        index: resolve(__dirname, 'src/lib.ts'),
        headless: resolve(__dirname, 'src/lib-headless.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: (id: string) =>
        id === 'yjs' ||
        id === 'y-prosemirror' ||
        id === 'y-protocols/awareness' ||
        id.startsWith('y-protocols/') ||
        id === '@hocuspocus/provider' ||
        id.startsWith('@milkdown/') ||
        id.startsWith('prosemirror-') ||
        id === 'lib0/encoding' ||
        id.startsWith('lib0/') ||
        id === 'unified' ||
        id === 'remark-parse' ||
        id === 'remark-stringify' ||
        id === 'remark-gfm' ||
        id === 'remark-frontmatter' ||
        id === 'mdast-util-directive' ||
        id === 'micromark-extension-directive',
    },
  },
});
