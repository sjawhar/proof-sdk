import { createHeadlessProof } from '../lib-headless.js';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed += 1; console.log(`  ✓ ${name}`); })
    .catch((error) => { failed += 1; console.error(`  ✗ ${name}`); console.error(`    ${(error as Error).message}`); });
}
function assert(condition: boolean, message: string): void { if (!condition) throw new Error(message); }

type DomSpec = [string, Record<string, string | null | undefined>, ...unknown[]];

console.log('\n=== dispatch-links ===');

await test('a dispatch:// link keeps its target as data-dispatch-href while href stays sanitized', async () => {
  const { parseMarkdown, schema } = await createHeadlessProof();
  const doc = parseMarkdown('See [the spec](dispatch://CORE-1/spec) and [site](https://example.com/x).');
  const marks: DomSpec[] = [];
  doc.descendants((node) => {
    for (const mark of node.marks) {
      if (mark.type.name === 'link') marks.push((schema.marks.link!.spec.toDOM as (m: typeof mark, inline: boolean) => DomSpec)(mark, true));
    }
  });
  assert(marks.length === 2, `expected 2 link marks, got ${marks.length}`);
  const [dispatch, external] = marks;
  assert(dispatch![1]['data-dispatch-href'] === 'dispatch://CORE-1/spec', `dispatch attrs: ${JSON.stringify(dispatch![1])}`);
  assert((dispatch![1].href ?? '') === '', `dispatch href should be sanitized empty: ${JSON.stringify(dispatch![1])}`);
  assert(external![1].href === 'https://example.com/x', `external attrs: ${JSON.stringify(external![1])}`);
  assert(!('data-dispatch-href' in external![1]), `external must not carry data-dispatch-href: ${JSON.stringify(external![1])}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
