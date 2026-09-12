const blockSchema = {
  version: 1,
  types: [
    {
      name: 'callout',
      content: 'paragraph+' as const,
      render: 'host' as const,
      attributes: {
        kind: { kind: 'enum' as const, choices: ['note', 'warning'], default: 'note' },
      },
    },
  ],
};

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

console.log('\n=== Headless distribution without DOM ===');

try {
  assert(!('document' in globalThis), 'this regression must run without a DOM global');

  // Dynamic import keeps the built package-entry failure inside this regression's assertion flow.
  const { createHeadlessProof } = await import('../../dist/headless.js');
  const proof = await createHeadlessProof({ blockSchema });
  const block = proof.parseMarkdown(':::callout{kind="warning"}\nBody\n:::\n').child(0);

  assert(block.type.name === 'callout', `parsed node type = ${block.type.name}`);
  assert(block.attrs.kind === 'warning', `parsed attribute kind = ${block.attrs.kind}`);
  console.log('  ✓ imports the built headless entry and creates typed blocks without a DOM');
} catch (error) {
  console.error(`  ✗ ${(error as Error).message}`);
  process.exitCode = 1;
}
