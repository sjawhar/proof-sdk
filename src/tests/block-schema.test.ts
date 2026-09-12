import { createHeadlessProof } from '../lib-headless.js';

let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
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

const blockSchema = {
  version: 1,
  types: [
    {
      name: 'callout',
      content: 'paragraph+',
      render: 'host' as const,
      attributes: {
        kind: { kind: 'enum' as const, choices: ['note', 'warning'], default: 'note' },
        title: { kind: 'string' as const, default: '' },
      },
    },
  ],
};

console.log('\n=== Block schema ===');

await test('headless Proof registers a typed block and round-trips its remark-directive form', async () => {
  let id = 0;
  const proof = await createHeadlessProof({ blockId: () => `b-${++id}`, blockSchema });
  const markdown = ':::callout{#callout-1 kind="warning" title="Read this"}\nBody text.\n:::\n';
  const doc = proof.parseMarkdown(markdown);
  const callout = doc.child(0);
  assert(callout.type.name === 'callout', `parsed node type = ${callout.type.name}`);
  assert(callout.attrs.blockId === 'callout-1', `callout id = ${callout.attrs.blockId}`);
  assert(callout.attrs.kind === 'warning', `callout kind = ${callout.attrs.kind}`);
  assert(callout.attrs.title === 'Read this', `callout title = ${callout.attrs.title}`);
  assert(proof.serializeMarkdown(doc) === markdown, 'typed block markdown did not round-trip');
});

if (failed > 0) process.exitCode = 1;
