import { isMermaidCodeBlockLanguage, renderProofMermaidSvg } from '../editor/plugins/mermaid-diagrams';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log('  ✓', name);
  } catch (error) {
    console.error('  ✗', name);
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}

test('mermaid language detection is case-insensitive', () => {
  assert(isMermaidCodeBlockLanguage('mermaid'), 'Expected lowercase mermaid to match');
  assert(isMermaidCodeBlockLanguage(' Mermaid '), 'Expected whitespace-trimmed Mermaid to match');
  assert(!isMermaidCodeBlockLanguage('markdown'), 'Expected non-mermaid language to be ignored');
});

test('proof mermaid renderer returns inline svg markup', () => {
  const svg = renderProofMermaidSvg([
    'flowchart LR',
    '  A["Monologue client"] -->|WebSocket| B["Realtime gateway"]',
    '  B --> C["ASR provider"]',
  ].join('\n'));

  assert(svg.startsWith('<svg'), 'Expected renderer to return SVG markup');
  assert(svg.includes('Monologue client'), 'Expected rendered SVG to include node label text');
  assert(svg.includes('Realtime gateway'), 'Expected rendered SVG to include downstream node label text');
});

test('proof mermaid renderer rejects dangling edges', () => {
  let threw = false;
  try {
    renderProofMermaidSvg([
      'flowchart LR',
      '  A -->',
    ].join('\n'));
  } catch (error) {
    threw = true;
    assert(error instanceof Error && error.message.includes('Dangling Mermaid edge'), 'Expected dangling edge validation error');
  }

  assert(threw, 'Expected malformed Mermaid edge to throw');
});

test('proof mermaid renderer rejects dangling labeled edges', () => {
  let threw = false;
  try {
    renderProofMermaidSvg([
      'flowchart LR',
      '  A -->|WebSocket|',
    ].join('\n'));
  } catch (error) {
    threw = true;
    assert(error instanceof Error && error.message.includes('Dangling Mermaid edge'), 'Expected dangling labeled edge validation error');
  }

  assert(threw, 'Expected malformed labeled Mermaid edge to throw');
});

function renderError(source: string): Error | null {
  try {
    renderProofMermaidSvg(source);
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

test('proof mermaid renderer renders a sequence diagram', () => {
  const svg = renderProofMermaidSvg([
    'sequenceDiagram',
    '  participant A as Machine A',
    '  participant B as Bucket',
    '  A->>B: create builds/M if absent',
    '  B-->>A: created',
    '  Note over A: build module M',
  ].join('\n'));

  assert(svg.startsWith('<svg'), 'Expected sequence diagram to render SVG markup');
  assert(svg.includes('Machine A'), 'Expected rendered SVG to include participant label');
  assert(svg.includes('create builds/M if absent'), 'Expected rendered SVG to include message text');
});

test('proof mermaid renderer sends every non-flowchart type to its own renderer', () => {
  const diagrams: Record<string, string[]> = {
    sequence: ['sequenceDiagram', '  Alice->>Bob: hello', '  Bob-->>Alice: hi'],
    class: ['classDiagram', '  Animal <|-- Duck', '  Animal : +int age'],
    er: ['erDiagram', '  CUSTOMER ||--o{ ORDER : places'],
    xychart: ['xychart-beta', '  x-axis [a, b, c]', '  bar [1, 2, 3]'],
  };
  for (const [type, lines] of Object.entries(diagrams)) {
    const error = renderError(lines.join('\n'));
    assert(error === null, `Expected ${type} diagram to render, got: ${error?.message}`);
  }
});

test('proof mermaid renderer still renders state diagrams and top-down flowcharts', () => {
  const state = renderError(['stateDiagram-v2', '  [*] --> Idle', '  Idle --> Busy', '  Busy --> [*]'].join('\n'));
  assert(state === null, `Expected state diagram to render, got: ${state?.message}`);
  const flowchart = renderError(['flowchart TD', '  A --> B', '  B --> C'].join('\n'));
  assert(flowchart === null, `Expected flowchart TD to render, got: ${flowchart?.message}`);
});

test('proof mermaid renderer still refuses a flowchart ending in an arrow', () => {
  const error = renderError(['flowchart TD', '  A --> B', '  B -->'].join('\n'));
  assert(error !== null && error.message.includes('Dangling Mermaid edge'), 'Expected dangling edge validation error');
});

test('proof mermaid renderer still refuses connectors with no parsed edges in a state diagram', () => {
  const error = renderError(['stateDiagram-v2', '  Idle -- Busy'].join('\n'));
  assert(error !== null, 'Expected state diagram validation to keep running');
});

test('proof mermaid renderer hands malformed sequence lines to the sequence parser', () => {
  // beautiful-mermaid's sequence parser skips lines it cannot read rather than throwing, so the
  // flowchart header check must not stand in for it.
  const error = renderError(['sequenceDiagram', '  this is not a message'].join('\n'));
  assert(error === null, `Expected the sequence parser to handle the source, got: ${error?.message}`);
});

test('proof mermaid renderer still surfaces an empty diagram error', () => {
  const error = renderError('   ');
  assert(error?.message === 'Empty mermaid diagram', `Expected the empty diagram error, got: ${error?.message}`);
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
