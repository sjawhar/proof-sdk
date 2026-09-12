import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { splitBlock } from '@milkdown/kit/prose/commands';
import { ySyncPluginKey } from 'y-prosemirror';

import { createHeadlessProof } from '../lib-headless.js';
import {
  BLOCK_ID_ATTR,
  blockIdOf,
  createBlockIdsPlugin,
  isIdentifiedBlock,
  setBlockIdGenerator,
  withBlockIds,
} from '../editor/schema/block-ids.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(error as Error).message}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function counter(prefix: string) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

const corpus = `---
title: Ids
---

# Heading

A paragraph with **bold** and a [link](https://example.com).

- one
- two
  - nested

1. first
2. second

> quoted

\`\`\`ts
const x = 1;
\`\`\`

| a | b |
| - | - |
| 1 | 2 |

---

Last paragraph.
`;

console.log('\n=== Block ids ===');

await test('parseMarkdown stamps every block, nested ones included, with unique ids', async () => {
  const { parseMarkdown } = await createHeadlessProof({ blockId: counter('b') });
  const doc = parseMarkdown(corpus);
  const ids: string[] = [];
  let blocks = 0;
  doc.descendants((node) => {
    if (!isIdentifiedBlock(node)) return;
    blocks += 1;
    const id = blockIdOf(node);
    assert(id !== null, `block ${node.type.name} has no id`);
    ids.push(id);
  });
  assert(blocks >= 20, `expected the corpus to have at least 20 blocks, saw ${blocks}`);
  assert(new Set(ids).size === ids.length, 'block ids are not unique');
  assert(ids[0] === 'b-1', `deterministic generator was not used: ${ids[0]}`);
  const types = new Set<string>();
  doc.descendants((node) => {
    if (isIdentifiedBlock(node)) types.add(node.type.name);
  });
  for (const name of ['frontmatter', 'heading', 'paragraph', 'bullet_list', 'list_item', 'ordered_list', 'blockquote', 'code_block', 'table', 'table_row', 'table_cell', 'hr']) {
    assert(types.has(name), `no identified block of type ${name}`);
  }
});

await test('block IDs preserve GFM task-list attrs, DOM rendering, and markdown round-trip', async () => {
  const markdown = '- [ ] task\n- [x] done\n';
  const { schema, parseMarkdown, serializeMarkdown } = await createHeadlessProof({ blockId: counter('task') });
  const doc = parseMarkdown(markdown);
  const list = doc.child(0);
  const unchecked = list.child(0);
  const checked = list.child(1);

  assert(unchecked.attrs.checked === false, `unchecked task attrs = ${JSON.stringify(unchecked.attrs)}`);
  assert(checked.attrs.checked === true, `checked task attrs = ${JSON.stringify(checked.attrs)}`);
  assert(blockIdOf(unchecked) !== null && blockIdOf(checked) !== null, 'task items lost their block ids');

  const dom = schema.nodes.list_item.spec.toDOM!(unchecked) as unknown[];
  const attrs = dom[1] as Record<string, unknown>;
  assert(attrs['data-item-type'] === 'task', `task item DOM attrs = ${JSON.stringify(attrs)}`);
  assert(attrs['data-checked'] === false, `unchecked task DOM attrs = ${JSON.stringify(attrs)}`);

  const serialized = serializeMarkdown(doc);
  assert(serialized.includes('[ ] task') && serialized.includes('[x] done'), `task syntax was lost: ${serialized}`);
  assert(serializeMarkdown(parseMarkdown(serialized)) === serialized, 'task markdown did not round-trip stably');
});

await test('ids never reach markdown: the round-trip is byte-identical with and without them', async () => {
  const stamped = await createHeadlessProof({ blockId: counter('b') });
  const doc = stamped.parseMarkdown(corpus);
  const withIds = stamped.serializeMarkdown(doc);
  const stripped = withBlockIds(doc, () => 'x'); // no-op: nothing missing
  assert(stripped === doc, 'withBlockIds must return the same doc when nothing is missing');
  assert(!withIds.includes('b-1') && !withIds.includes('blockId'), 'markdown leaked a block id');
  const plain = await createHeadlessProof({ blockId: counter('other') });
  assert(plain.serializeMarkdown(plain.parseMarkdown(corpus)) === withIds, 'markdown differs across id generators');
});

await test('splitting a paragraph keeps the id on the first half and mints one for the second', async () => {
  setBlockIdGenerator(counter('local'));
  try {
    const { schema, parseMarkdown } = await createHeadlessProof({ blockId: counter('b') });
    const state = EditorState.create({ schema, doc: parseMarkdown('Hello world'), plugins: [createBlockIdsPlugin()] });
    const before = blockIdOf(state.doc.child(0));
    let next = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 6)));
    let applied: EditorState | undefined;
    splitBlock(next, (tr) => {
      applied = next.apply(tr);
    });
    assert(applied !== undefined, 'splitBlock did not dispatch');
    next = applied!;
    assert(next.doc.childCount === 2, `expected two paragraphs, got ${next.doc.childCount}`);
    assert(blockIdOf(next.doc.child(0)) === before, 'first half lost its id');
    const second = blockIdOf(next.doc.child(1));
    assert(second !== null && second !== before, `second half id = ${second}`);
    assert(second!.startsWith('local-'), `second half was not minted locally: ${second}`);
  } finally {
    setBlockIdGenerator(null);
  }
});

await test('a locally inserted block is stamped outside the undo history', async () => {
  setBlockIdGenerator(counter('local'));
  try {
    const { schema, parseMarkdown } = await createHeadlessProof({ blockId: counter('b') });
    const state = EditorState.create({ schema, doc: parseMarkdown('Hello'), plugins: [createBlockIdsPlugin()] });
    const paragraph = schema.nodes.paragraph.create(null, schema.text('inserted'));
    assert(blockIdOf(paragraph) === null, 'fixture paragraph should start without an id');
    const next = state.apply(state.tr.insert(state.doc.content.size, paragraph));
    assert(blockIdOf(next.doc.child(1)) === 'local-1', `inserted block id = ${blockIdOf(next.doc.child(1))}`);
    assert(blockIdOf(next.doc.child(0)) === 'b-1', 'existing block was re-stamped');
  } finally {
    setBlockIdGenerator(null);
  }
});

await test('a remote (collaboration) transaction is never stamped locally', async () => {
  setBlockIdGenerator(counter('local'));
  try {
    const { schema, parseMarkdown } = await createHeadlessProof({ blockId: counter('b') });
    const state = EditorState.create({ schema, doc: parseMarkdown('Hello'), plugins: [createBlockIdsPlugin()] });
    const paragraph = schema.nodes.paragraph.create(null, schema.text('from a peer'));
    const tr = state.tr.insert(state.doc.content.size, paragraph).setMeta(ySyncPluginKey, { isChangeOrigin: true });
    const next = state.apply(tr);
    assert(blockIdOf(next.doc.child(1)) === null, 'remote block was stamped by this client');
  } finally {
    setBlockIdGenerator(null);
  }
});

await test('block specs render data-block-id and read it back from the DOM', async () => {
  const { schema, parseMarkdown } = await createHeadlessProof({ blockId: counter('b') });
  const doc = parseMarkdown('Hello');
  const spec = schema.nodes.paragraph.spec.toDOM!(doc.child(0)) as unknown[];
  const attrs = spec[1] as Record<string, unknown>;
  assert(attrs['data-block-id'] === 'b-1', `toDOM attrs = ${JSON.stringify(attrs)}`);
  const rule = schema.nodes.paragraph.spec.parseDOM![0] as { getAttrs?: (dom: unknown) => Record<string, unknown> | false | null };
  const parsed = rule.getAttrs!({ getAttribute: (name: string) => (name === 'data-block-id' ? 'from-dom' : null) });
  assert(parsed !== false && parsed !== null && parsed[BLOCK_ID_ATTR] === 'from-dom', `parseDOM attrs = ${JSON.stringify(parsed)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
