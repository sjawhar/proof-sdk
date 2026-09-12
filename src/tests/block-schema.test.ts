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
      render: 'host',
      attributes: {
        kind: { kind: 'enum', choices: ['note', 'warning'], default: 'note' },
        title: { kind: 'string', default: '' },
      },
    },
    {
      name: 'transcript',
      content: 'block+',
      render: 'host',
      attributes: {},
    },
    {
      name: 'ask',
      content: 'paragraph+ bullet_list?',
      render: 'host',
      attributes: {},
    },
  ],
} as const;

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
await test('headless Proof round-trips a typed block with arbitrary block children', async () => {
  let id = 0;
  const proof = await createHeadlessProof({ blockId: () => `b-${++id}`, blockSchema });
  const markdown = [
    ':::transcript{#transcript-1}',
    'Opening paragraph.',
    '',
    '* First point',
    '* Second point',
    '',
    '```ts',
    'const answer = 42;',
    '```',
    '',
    '> Quoted context.',
    ':::',
    '',
  ].join('\n');
  const doc = proof.parseMarkdown(markdown);
  const transcript = doc.child(0);
  assert(transcript.type.name === 'transcript', `parsed node type = ${transcript.type.name}`);
  const serialized = proof.serializeMarkdown(doc);
  assert(serialized === markdown, `block+ typed block markdown did not round-trip: ${JSON.stringify(serialized)}`);
});

await test('headless Proof accepts a paragraph sequence followed by an optional bullet list', async () => {
  let id = 0;
  const proof = await createHeadlessProof({ blockId: () => `b-${++id}`, blockSchema });
  const markdown = [
    ':::ask{#ask-1}',
    'Which option?',
    '',
    '* First option',
    '* Second option',
    ':::',
    '',
  ].join('\n');
  const doc = proof.parseMarkdown(markdown);
  const ask = doc.child(0);
  assert(ask.type.name === 'ask', `parsed node type = ${ask.type.name}`);
  const serialized = proof.serializeMarkdown(doc);
  assert(serialized === markdown, `paragraph+ bullet_list? typed block markdown did not round-trip: ${JSON.stringify(serialized)}`);
});

await test('headless Proof round-trips directive-like content in fenced code blocks', async () => {
  const proof = await createHeadlessProof({ blockSchema });
  for (const markdown of [
    '```md\n::: {.callout}\n```\n',
    '```md\n:::callout{#callout-1 kind="warning" title="Read this"}\n```\n',
  ]) {
    assert(
      proof.serializeMarkdown(proof.parseMarkdown(markdown)) === markdown,
      `fenced directive-like code did not round-trip: ${JSON.stringify(markdown)}`,
    );
  }
});
await test('headless Proof accepts directive-like content in indented code blocks', async () => {
  const proof = await createHeadlessProof({ blockSchema });
  const doc = proof.parseMarkdown('    ::: {.callout}\n');
  assert(doc.child(0).type.name === 'code_block', `parsed node type = ${doc.child(0).type.name}`);
});
await test('headless Proof rejects Pandoc fenced div syntax outside code blocks', async () => {
  const proof = await createHeadlessProof({ blockSchema });
  let thrown: unknown;
  try {
    proof.parseMarkdown('::: {.callout}\nBody text.\n:::\n');
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof Error, 'Pandoc fenced div syntax did not fail');
  assert(
    thrown instanceof Error
      && thrown.message === 'line 1: typed block directives use :::name{...}; Pandoc fenced divs and malformed directives are not supported',
    `Pandoc fenced div error = ${(thrown as Error).message}`,
  );
});
await test('headless Proof rejects leaf and text directives', async () => {
  const proof = await createHeadlessProof({ blockSchema });
  const cases = [
    ['::note{value}\n', 'leaf directives (::name) are not supported'],
    [':note[value]\n', 'text directives (:name{...}) are not supported'],
  ] as const;
  for (const [markdown, message] of cases) {
    let thrown: unknown;
    try {
      proof.parseMarkdown(markdown);
    } catch (error) {
      thrown = error;
    }
    assert(thrown instanceof Error, `unsupported directive ${JSON.stringify(markdown)} did not fail`);
    assert(
      thrown instanceof Error && thrown.message === message,
      `unsupported directive error = ${(thrown as Error).message}`,
    );
  }
});

await test('headless Proof rejects a content rule naming an unknown node type', async () => {
  let thrown: unknown;
  try {
    await createHeadlessProof({
      blockSchema: {
        version: 1,
        types: [{
          name: 'invalid',
          content: 'unknown_block+',
          render: 'host',
          attributes: {},
        }],
      },
    });
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof Error, 'unknown content rule did not fail schema creation');
  assert(
    thrown instanceof Error && thrown.message.includes("No node type or group 'unknown_block'"),
    `unknown content rule error = ${(thrown as Error).message}`,
  );
});
if (failed > 0) process.exitCode = 1;
