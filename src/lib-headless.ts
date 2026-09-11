/**
 * Proof Editor — headless (Node/Bun, no DOM) markdown <-> ProseMirror entry
 * point, published alongside ./lib.ts as @sjawhar/proof-editor/headless.
 *
 * Ported from server/milkdown-headless.ts's `buildHeadless()`: the same
 * Milkdown schema plugin list the browser editor uses (commonmark, gfm,
 * frontmatter, code-block-ext, proof marks) plus this library's own
 * dispatchAsk mark (./dispatch-marks.ts), so a document parsed/serialized
 * here uses exactly the same ProseMirror schema as the browser editor. The
 * fallback/warm-up machinery in that file (parseMarkdownWithHtmlFallback,
 * stripStandaloneHtmlLines, the warm/singleton cache) is intentionally not
 * ported — this is a plain factory a host calls once and reuses, mirroring
 * `createProofEditor`'s own shape.
 */

import { Editor, editorViewCtx, marksCtx, nodesCtx, remarkStringifyOptionsCtx } from '@milkdown/core';
import { schema as commonmarkSchema } from '@milkdown/preset-commonmark';
import { schema as gfmSchema } from '@milkdown/preset-gfm';
import { Schema, type Node as ProseMirrorNode } from '@milkdown/prose/model';
import { ParserState, SerializerState } from '@milkdown/transformer';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';

import { codeBlockExtPlugins } from './editor/schema/code-block-ext.js';
import { frontmatterSchema } from './editor/schema/frontmatter.js';
import { proofMarkPlugins } from './editor/schema/proof-marks.js';
import { remarkProofMarks, proofMarkHandler } from './formats/remark-proof-marks.js';
import { dispatchMarkPlugins, remarkDispatchMarks, dispatchMarkHandler } from './dispatch-marks.js';
import { remarkSoftBreakAsSpace } from './dispatch-soft-breaks.js';

export interface HeadlessProofEditor {
  schema: Schema;
  parseMarkdown(markdown: string): ProseMirrorNode;
  serializeMarkdown(doc: ProseMirrorNode): string;
}

export async function createHeadlessProof(): Promise<HeadlessProofEditor> {
  const editor = Editor.make();
  const ctx = editor.ctx;

  // These slices are normally injected by Milkdown's init plugin. We only need enough
  // context for schema plugins to materialize their node/mark specs.
  ctx.inject(nodesCtx, []);
  ctx.inject(marksCtx, []);
  ctx.inject(remarkStringifyOptionsCtx, { handlers: {}, encode: [] });

  // Some schema serializers reference the editor view (e.g. paragraph serialization
  // checks if the node is the last block). Provide a minimal stub updated per
  // serialization run to avoid ctx lookup errors in headless mode.
  let currentDoc: ProseMirrorNode | null = null;
  ctx.inject(editorViewCtx, {
    state: {
      get doc() {
        return currentDoc;
      },
    },
  } as never);

  const plugins = [
    ...commonmarkSchema,
    ...gfmSchema,
    // Frontmatter must be registered after commonmark so `---` parses as YAML.
    ...frontmatterSchema,
    ...codeBlockExtPlugins,
    // Some schema nodes reference proof marks (e.g. code_block allows them).
    ...proofMarkPlugins,
    ...dispatchMarkPlugins,
  ].flat();

  for (const plugin of plugins) {
    const runner = plugin(ctx);
    if (typeof runner === 'function') {
      // Schema plugins are async but typically complete synchronously.
      await runner();
    }
  }

  const nodes = Object.fromEntries(ctx.get(nodesCtx) as never);
  const marks = Object.fromEntries(ctx.get(marksCtx) as never);
  const schema = new Schema({ nodes, marks });

  // Match the browser editor's GFM features (tables, task lists, strikethrough,
  // autolinks, ...), plus proof span and dispatchAsk span parsing.
  const parseProcessor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkGfm)
    .use(remarkProofMarks)
    .use(remarkDispatchMarks)
    .use(remarkSoftBreakAsSpace);
  const parseMarkdown = ParserState.create(schema as never, parseProcessor as never) as unknown as (
    markdown: string,
  ) => ProseMirrorNode;

  const serializeProcessor = unified()
    .use(remarkGfm)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkStringify, {
      handlers: {
        proofMark: proofMarkHandler,
        dispatchMark: dispatchMarkHandler,
      },
    });
  const serializer = SerializerState.create(schema as never, serializeProcessor as never) as unknown as (
    doc: ProseMirrorNode,
  ) => string;
  const serializeMarkdown = (doc: ProseMirrorNode): string => {
    currentDoc = doc;
    return serializer(doc);
  };

  return { schema, parseMarkdown, serializeMarkdown };
}

export default createHeadlessProof;
