// Throwaway smoke script for the @sjawhar/proof-editor/headless entry point.
// Run with: bun scripts/headless-smoke.mjs (from the built dist/, or via
// tsx/bun against src/lib-headless.ts directly during development).
import { createHeadlessProof } from '../src/lib-headless.ts';

const md = '# Hello\n\nSome **bold** [link](https://x)\n\n- [ ] task\n\n| a | b |\n|---|---|\n| 1 | 2 |';

const { parseMarkdown, serializeMarkdown } = await createHeadlessProof();

const doc = parseMarkdown(md);
console.log('=== doc.toJSON() ===');
console.log(JSON.stringify(doc.toJSON(), null, 2));

const roundTripped = serializeMarkdown(parseMarkdown(md));
console.log('=== serializeMarkdown(parseMarkdown(md)) ===');
console.log(roundTripped);
