/**
 * Regression: editor decorations must not carry inline styles.
 *
 * An inline decoration's span is ProseMirror-managed DOM. When an extension that rewrites inline
 * styles (Dark Reader, and any agent doing the same) rewrites the `style` attribute on one,
 * prosemirror-view registers the attribute mutation, marks the range dirty and redraws, which
 * reapplies the decoration's `style` — an endless redraw loop that wedges the tab.
 * (prosemirror-view dist/index.js:1110 ViewDesc.ignoreMutation, :4873 registerMutation, :4915.)
 *
 * The decoration paint therefore lives in the stylesheets these plugins already inject, keyed by
 * the classes the decorations already carry, at single-class specificity so a host page can still
 * restyle marks with its own rules.
 *
 * Covers marks.ts (compose anchor, comment, active comment, insert, delete, replace, and the
 * replace-insert widget) and collab-cursors.ts (cursor widget, its label and avatar, and the
 * collaborator selection decoration).
 */

import type { Ctx } from '@milkdown/kit/ctx';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';
import { DecorationSet } from '@milkdown/kit/prose/view';
import { marksPlugin, marksPluginKey } from '../editor/plugins/marks.js';
import { collabCursorBuilder, collabSelectionBuilder } from '../editor/plugins/collab-cursors.js';

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    return;
  }
  failed++;
  console.error(`  FAIL: ${message}`);
}

function assertIncludes(haystack: string, needle: string, message: string): void {
  assert(haystack.includes(needle), `${message}\n    Missing: ${needle}`);
}

// ---------------------------------------------------------------------------
// Minimal DOM. The repository has no DOM implementation in its dependencies; these plugins only
// need element creation, a head to inject a <style> into, and lookup by id. Neither plugin module
// touches `document` while it loads, so installing this before the first call is enough.
// ---------------------------------------------------------------------------

const STYLE_DECLARATIONS = Symbol('style declarations');

type StyleStub = Record<string, string> & { [STYLE_DECLARATIONS]: Map<string, string> };

function createStyleStub(): StyleStub {
  const declarations = new Map<string, string>();
  const stub = new Proxy({} as Record<string, string>, {
    get(_target, property) {
      if (property === STYLE_DECLARATIONS) return declarations;
      if (typeof property === 'symbol') return undefined;
      if (property === 'setProperty') {
        return (name: string, value: string) => void declarations.set(name, String(value));
      }
      if (property === 'removeProperty') return (name: string) => void declarations.delete(name);
      if (property === 'getPropertyValue') return (name: string) => declarations.get(name) ?? '';
      return declarations.get(property) ?? '';
    },
    set(_target, property, value) {
      if (typeof property === 'symbol') return true;
      if (value === '' || value === undefined || value === null) declarations.delete(property);
      else declarations.set(property, String(value));
      return true;
    },
  });
  // The proxy answers every property; only its own declaration map is not a CSS property name.
  return stub as StyleStub;
}

class StubElement {
  readonly tagName: string;
  className = '';
  id = '';
  textContent = '';
  src = '';
  alt = '';
  width = 0;
  height = 0;
  loading = '';
  decoding = '';
  readonly style = createStyleStub();
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  children: unknown[] = [];
  readonly classList = {
    add: (...names: string[]): void => {
      const current = this.className.split(/\s+/).filter(Boolean);
      for (const name of names) if (!current.includes(name)) current.push(name);
      this.className = current.join(' ');
    },
  };

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild<T>(child: T): T {
    this.children.push(child);
    return child;
  }

  replaceChildren(...nodes: unknown[]): void {
    this.children = nodes;
  }
}

const head = new StubElement('head');

const documentStub = {
  head,
  createElement: (tagName: string) => new StubElement(tagName),
  createTextNode: (text: string) => ({ nodeType: 3, textContent: text }),
  getElementById: (id: string): StubElement | null =>
    (head.children as StubElement[]).find((child) => child instanceof StubElement && child.id === id) ?? null,
};

Object.assign(globalThis, { document: documentStub });

/** Everything a real browser would serialize into the element's `style` attribute. */
function inlineStyleOf(element: StubElement): string {
  const fromProperties = Array.from(element.style[STYLE_DECLARATIONS], ([name, value]) => `${name}: ${value}`);
  return [element.attributes.get('style'), ...fromProperties].filter(Boolean).join('; ');
}

// ---------------------------------------------------------------------------
// Decorations from the real marks plugin
// ---------------------------------------------------------------------------

// Suggestion metadata only survives normalization when the document anchors it, so the test
// schema carries the proof mark types the editor's own schema defines.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'text*', group: 'block' },
    text: { group: 'inline' },
  },
  marks: {
    proofSuggestion: {
      attrs: { id: { default: null }, kind: { default: 'replace' }, by: { default: 'unknown' } },
      inclusive: false,
      spanning: true,
    },
    proofComment: {
      attrs: { id: { default: null }, by: { default: 'unknown' } },
      inclusive: false,
      spanning: true,
    },
  },
});

const DOC_TEXT = 'alpha bravo charlie delta echo';
const doc = schema.node('doc', null, [
  schema.node('paragraph', null, [
    schema.text('alpha', [schema.marks.proofComment.create({ id: 'comment-1', by: 'human:tester' })]),
    schema.text(' '),
    schema.text('bravo', [schema.marks.proofSuggestion.create({ id: 'insert-1', kind: 'insert', by: 'ai:tester' })]),
    schema.text(' '),
    schema.text('charlie', [schema.marks.proofSuggestion.create({ id: 'delete-1', kind: 'delete', by: 'ai:tester' })]),
    schema.text(' '),
    schema.text('delta', [schema.marks.proofSuggestion.create({ id: 'replace-1', kind: 'replace', by: 'ai:tester' })]),
    schema.text(' echo'),
  ]),
]);
// The paragraph's text starts at position 1, and `echo` carries no mark of its own.
const composeFrom = 1 + DOC_TEXT.indexOf('echo');
const composeRange = { from: composeFrom, to: composeFrom + 'echo'.length };

// Older than the 2s glow window, so no decoration picks up the transient `proof-mark-new` class.
const createdAt = new Date(Date.now() - 60_000).toISOString();

const metadata = {
  'comment-1': {
    kind: 'comment' as const,
    by: 'human:tester',
    createdAt,
    quote: 'alpha',
    text: 'Needs a citation',
    threadId: 'comment-1',
    thread: [],
    resolved: false,
  },
  'insert-1': { kind: 'insert' as const, by: 'ai:tester', createdAt, quote: 'bravo', status: 'pending' as const, content: 'bravo' },
  'delete-1': { kind: 'delete' as const, by: 'ai:tester', createdAt, quote: 'charlie', status: 'pending' as const },
  'replace-1': { kind: 'replace' as const, by: 'ai:tester', createdAt, quote: 'delta', status: 'pending' as const, content: 'foxtrot' },
};

// `$prose` hands the ProseMirror plugin back once its milkdown wrapper has run. The marks factory
// ignores the context it is given, so a context that answers `$prose`'s own wait and update is
// enough to build the real plugin.
const proseContext = {
  wait: async () => undefined,
  update: (_slice: unknown, updater: (plugins: unknown[]) => unknown[]) => void updater([]),
} as unknown as Ctx;
await marksPlugin(proseContext)();
const prosePlugin = marksPlugin.plugin();

let state = EditorState.create({ schema, doc, plugins: [prosePlugin] });
state = state.apply(state.tr.setMeta(marksPluginKey, { type: 'SET_METADATA', metadata }));
state = state.apply(state.tr.setMeta(marksPluginKey, { type: 'SET_COMPOSE_ANCHOR', range: composeRange }));
const activeState = state.apply(state.tr.setMeta(marksPluginKey, { type: 'SET_ACTIVE', markId: 'comment-1' }));

/** What the view reads off a decoration when it renders; prosemirror-view does not export it. */
interface RenderedDecoration {
  type: {
    attrs?: { class?: string; style?: string };
    toDOM?: ((view: unknown, getPos: () => number) => StubElement) | StubElement;
  };
}

interface DecorationProbe {
  classes: string;
  style: string | undefined;
  widget: StubElement | null;
}

function probeDecorations(editorState: EditorState): DecorationProbe[] {
  const source = prosePlugin.props.decorations?.call(prosePlugin, editorState);
  if (!(source instanceof DecorationSet)) throw new Error('the marks plugin produced no decoration set');
  const rendered = source.find() as unknown as RenderedDecoration[];
  return rendered.map(({ type }) => {
    const widget = typeof type.toDOM === 'function' ? type.toDOM(null, () => 0) : (type.toDOM ?? null);
    return {
      classes: type.attrs?.class ?? widget?.className ?? '',
      style: type.attrs?.style,
      widget,
    };
  });
}

const probes = probeDecorations(state);
const activeProbes = probeDecorations(activeState);

// The decorations under test must actually have been produced, or the style assertions are vacuous.
for (const cssClass of ['mark-compose-anchor', 'mark-comment', 'mark-insert', 'mark-delete', 'mark-replace', 'mark-replace-insert']) {
  assert(
    probes.some((probe) => probe.classes.split(/\s+/).includes(cssClass)),
    `expected a decoration carrying .${cssClass}`
  );
}
assert(
  activeProbes.some((probe) => probe.classes.split(/\s+/).includes('mark-active')),
  'expected the active comment decoration to carry .mark-active'
);

for (const probe of [...probes, ...activeProbes]) {
  assert(probe.style === undefined, `decoration "${probe.classes}" still sets a style attribute: ${probe.style}`);
  if (probe.widget) {
    assert(
      inlineStyleOf(probe.widget) === '',
      `widget "${probe.classes}" still sets inline styles: ${inlineStyleOf(probe.widget)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Collaborator cursors and selections
// ---------------------------------------------------------------------------

const PEER_COLOR = '#ff8800';

const selectionAttrs = collabSelectionBuilder({ name: 'Ada', color: PEER_COLOR });
assert(
  selectionAttrs.style === undefined,
  `the collab selection decoration still sets a style attribute: ${selectionAttrs.style}`
);
assertIncludes(selectionAttrs.class ?? '', 'proof-collab-selection', 'the collab selection decoration should keep its class');

// The builders return the stub elements this test installed on `document`.
const avatarCursor = collabCursorBuilder({
  name: 'Ada',
  color: PEER_COLOR,
  avatar: 'https://example.com/ada.png',
}) as unknown as StubElement;
const avatarLabel = avatarCursor.children.find(
  (child): child is StubElement => child instanceof StubElement && child.className.includes('proof-collab-cursor__label')
);
assert(avatarLabel !== undefined, 'expected the cursor widget to carry a label');
const avatarImage = avatarLabel?.children.find(
  (child): child is StubElement => child instanceof StubElement && child.tagName === 'img'
);
assert(avatarImage !== undefined, 'expected an avatar image for a peer with an avatar URL');

// An agent peer takes the other label branch; its face icon is agent-identity-icon's own element
// and outside this fix, so only the label itself is asserted on.
const agentCursor = collabCursorBuilder({ name: 'Proof Agent', color: PEER_COLOR }) as unknown as StubElement;
const agentLabel = agentCursor.children.find(
  (child): child is StubElement => child instanceof StubElement && child.className.includes('proof-collab-cursor__label')
);
assert(agentLabel !== undefined, 'expected the agent cursor widget to carry a label');

const cursorElements: [string, StubElement | undefined][] = [
  ['cursor widget', avatarCursor],
  ['cursor label', avatarLabel],
  ['cursor avatar', avatarImage],
  ['agent cursor label', agentLabel],
];
for (const [name, element] of cursorElements) {
  if (!element) continue;
  assert(inlineStyleOf(element) === '', `the ${name} still sets inline styles: ${inlineStyleOf(element)}`);
}

// ---------------------------------------------------------------------------
// The paint moved into the injected stylesheets, unchanged
// ---------------------------------------------------------------------------

const markStyles = documentStub.getElementById('proof-mark-glow-styles')?.textContent ?? '';
assert(markStyles !== '', 'expected the marks plugin to inject proof-mark-glow-styles');

const markRules: [string, string][] = [
  ['.mark-comment', 'background-color: rgba(252, 211, 77, 0.3); border-bottom: 2px solid #FCD34D;'],
  ['.mark-active', 'background-color: rgba(252, 211, 77, 0.5); border-bottom: 2px solid #FBBF24;'],
  ['.mark-compose-anchor', 'background-color: rgba(252, 211, 77, 0.22); border-bottom: 2px dashed #F59E0B;'],
  ['.mark-insert', 'background-color: rgba(34, 197, 94, 0.25); border-bottom: 2px solid #22C55E;'],
  ['.mark-delete', 'background-color: rgba(239, 68, 68, 0.2); text-decoration: line-through; color: #666;'],
];
for (const [selector, declarations] of markRules) {
  assertIncludes(markStyles, `${selector} { ${declarations} }`, `expected ${selector} to keep its original declarations`);
}

const cursorStyles = documentStub.getElementById('proof-collab-cursor-styles')?.textContent ?? '';
assert(cursorStyles !== '', 'expected the collab cursor plugin to inject proof-collab-cursor-styles');
assertIncludes(cursorStyles, `--proof-collab-cursor-color: ${PEER_COLOR};`, "expected the peer's cursor colour to reach the stylesheet");
assertIncludes(
  cursorStyles,
  `linear-gradient(180deg, ${PEER_COLOR}14 0%, ${PEER_COLOR}0d 100%)`,
  "expected the peer's selection tint to keep its original colours"
);
assertIncludes(cursorStyles, `outline: 1px solid ${PEER_COLOR}2e`, "expected the peer's selection outline to keep its original colour");
assertIncludes(cursorStyles, `border-bottom: 2px solid ${PEER_COLOR}66`, "expected the peer's selection underline to keep its original colour");

const colorRuleCount = cursorStyles.split(`--proof-collab-cursor-color: ${PEER_COLOR};`).length - 1;
assert(colorRuleCount === 1, `expected one rule per peer colour, found ${colorRuleCount}`);

// A second peer's colour joins the sheet without evicting the first.
const SECOND_PEER_COLOR = '#22AA55';
collabSelectionBuilder({ name: 'Grace', color: SECOND_PEER_COLOR });
const twoColorStyles = documentStub.getElementById('proof-collab-cursor-styles')?.textContent ?? '';
assertIncludes(
  twoColorStyles,
  `--proof-collab-cursor-color: ${SECOND_PEER_COLOR};`,
  "expected a second peer's colour to reach the stylesheet"
);
assertIncludes(
  twoColorStyles,
  `--proof-collab-cursor-color: ${PEER_COLOR};`,
  "expected the first peer's colour to survive a second peer joining"
);
assertIncludes(
  twoColorStyles,
  `.proof-collab-selection--${SECOND_PEER_COLOR.slice(1).toLowerCase()} {`,
  "expected the second peer's selection rule to be keyed by its own class"
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
