/**
 * Browser smoke test for @sjawhar/proof-editor's browser entry (src/lib.ts).
 *
 * Two Y.Docs relay updates to each other in-memory (no server, no
 * HocuspocusProvider) to prove the library only needs a Y.Doc + awareness
 * from the host. Every assertion is host-realistic: content is seeded by
 * dispatching a ProseMirror transaction directly on `handle.view` (the only
 * document-mutation surface the contract exposes), never through any
 * removed spike-only handle method.
 */
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { createProofEditor, type ProofEditorHandle, type MarkAction } from '../src/lib';

const statusEl = document.getElementById('status')!;
const results: Record<string, boolean> = {};

function log(message: string): void {
  console.log('[smoke]', message);
  statusEl.textContent += `\n${message}`;
}

function record(name: string, pass: boolean, detail?: string): void {
  results[name] = pass;
  log(`${pass ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  window.setTimeout(resolve, ms);
  return promise;
}

function waitForPlaywrightAction(action: 'click' | 'hover' | 'type' | 'type-remote'): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const continueAction = () => {
    Object.assign(window, { __smokeAction: null });
    resolve();
  };
  Object.assign(window, { __smokeAction: action, __smokeContinueAction: continueAction });
  return promise;
}


window.addEventListener('error', (event) => log(`WINDOW ERROR: ${event.message}`));
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason as Error | undefined;
  log(`UNHANDLED REJECTION: ${reason?.message ?? String(event.reason)}`);
});

function relayDocs(a: Y.Doc, b: Y.Doc): void {
  a.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === 'relay') return;
    Y.applyUpdate(b, update, 'relay');
  });
}

function relayAwareness(a: Awareness, b: Awareness): void {
  a.on(
    'update',
    ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === 'relay') return;
      const update = encodeAwarenessUpdate(a, added.concat(updated, removed));
      applyAwarenessUpdate(b, update, 'relay');
    },
  );
}

function findTextRange(view: EditorView, needle: string): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  view.state.doc.descendants((node, pos) => {
    if (found || !node.isText || !node.text) return !found;
    const idx = node.text.indexOf(needle);
    if (idx < 0) return true;
    found = { from: pos + idx, to: pos + idx + needle.length };
    return false;
  });
  return found;
}

function docBHasDispatchAskAttribute(doc: Y.Doc): boolean {
  const fragment = doc.getXmlFragment('prosemirror');
  let found = false;
  const walk = (node: unknown) => {
    if (found || node == null || typeof node !== 'object') return;
    const withDelta = node as { toDelta?: () => Array<{ attributes?: Record<string, unknown> }> };
    if (typeof withDelta.toDelta === 'function') {
      for (const op of withDelta.toDelta()) {
        if (op.attributes && 'dispatchAsk' in op.attributes) {
          found = true;
          return;
        }
      }
    }
    const withChildren = node as { toArray?: () => unknown[] };
    if (typeof withChildren.toArray === 'function') {
      for (const child of withChildren.toArray()) walk(child);
    }
  };
  walk(fragment);
  return found;
}

function clickAskButton(): boolean {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('.dispatch-action-bar button')).find(
    (candidate) => candidate.textContent === 'Ask',
  );
  if (!button) return false;
  button.click();
  return true;
}

async function main(): Promise<void> {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  relayDocs(docA, docB);
  relayDocs(docB, docA);

  const awarenessA = new Awareness(docA);
  const awarenessB = new Awareness(docB);
  relayAwareness(awarenessA, awarenessB);
  relayAwareness(awarenessB, awarenessA);

  const rootA = document.getElementById('editor-a')!;
  const rootB = document.getElementById('editor-b')!;

  const markActionsA: MarkAction[] = [];
  let rejectNextAsk = false;

  const handleA: ProofEditorHandle = await createProofEditor(rootA, {
    ydoc: docA,
    awareness: awarenessA,
    user: { name: 'Alice', color: '#ef4444' },
    onMarkAction: async (action) => {
      markActionsA.push(action);
      log(`A onMarkAction: ${JSON.stringify(action)}`);
      if (action.kind === 'ask' && rejectNextAsk) {
        rejectNextAsk = false;
        throw new Error('simulated host rejection');
      }
    },
  });
  await waitForPlaywrightAction('type');
  const handleB: ProofEditorHandle = await createProofEditor(rootB, {
    ydoc: docB,
    awareness: awarenessB,
    user: { name: 'Bob', color: '#3b82f6' },
  });
  record('both editors created', true);

  // --- 1. content is typed into A by Playwright ---
  await sleep(400);
  record('type in A appears in B', handleB.view.state.doc.textContent.includes('Hello world'));

  // --- 2. select "bold text" in A, Ask button should appear, click it ---
  const askRange = findTextRange(handleA.view, 'bold text');
  if (!askRange) throw new Error('could not locate "bold text" in editor A');
  handleA.view.dispatch(handleA.view.state.tr.setSelection(TextSelection.create(handleA.view.state.doc, askRange.from, askRange.to)));
  handleA.view.focus();
  await sleep(100);

  const askBar = document.querySelector<HTMLElement>('.dispatch-action-bar');
  record('ask button visible after selection', !!askBar && askBar.style.display !== 'none' && !!Array.from(askBar.querySelectorAll('button')).find((b) => b.textContent === 'Ask'));

  const clicked = clickAskButton();
  record('ask button click dispatched', clicked);
  await sleep(300);

  const lastAction = markActionsA[markActionsA.length - 1];
  record(
    'onMarkAction fired with kind=ask, quote, and range',
    lastAction?.kind === 'ask' && 'quote' in lastAction && lastAction.quote === 'bold text' && lastAction.from === askRange.from && lastAction.to === askRange.to,
    JSON.stringify(lastAction),
  );

  await sleep(400);
  record('dispatchAsk attribute appears in B raw Y.XmlText', docBHasDispatchAskAttribute(docB));

  const firstAskMarkId = lastAction && 'markId' in lastAction ? lastAction.markId : null;
  record('editor A DOM has the dispatchAsk span', !!firstAskMarkId && !!rootA.querySelector(`[data-id="${firstAskMarkId}"]`));

  log('CHECKPOINT: first ask mark visible in both panes; pausing for screenshot');
  await sleep(300);
  log('CHECKPOINT: resuming');

  // --- 3. select a different span, reject the hook, mark should be removed ---
  const rejectRange = findTextRange(handleA.view, 'the plan');
  if (!rejectRange) throw new Error('could not locate "the plan" in editor A');
  handleA.view.dispatch(handleA.view.state.tr.setSelection(TextSelection.create(handleA.view.state.doc, rejectRange.from, rejectRange.to)));
  handleA.view.focus();
  await sleep(100);
  rejectNextAsk = true;
  clickAskButton();
  await sleep(300);

  const rejectedAction = markActionsA[markActionsA.length - 1];
  const rejectedMarkId = rejectedAction && 'markId' in rejectedAction ? rejectedAction.markId : null;
  record(
    'mark removed locally after onMarkAction rejects',
    !!rejectedMarkId && !rootA.querySelector(`[data-id="${rejectedMarkId}"]`),
  );

  // --- 4. focusMark scrolls + pulses the surviving ask mark ---
  if (firstAskMarkId) {
    handleA.focusMark(firstAskMarkId);
    await sleep(50);
    record('focusMark applies the pulse class', !!rootA.querySelector('.dispatch-mark-pulse'));
  } else {
    record('focusMark applies the pulse class', false, 'no surviving ask mark id to focus');
  }

  // --- 5. removeMark imperatively removes the surviving ask mark ---
  if (firstAskMarkId) {
    handleA.removeMark(firstAskMarkId);
    await sleep(50);
    record('removeMark removes the dispatchAsk span', !rootA.querySelector(`[data-id="${firstAskMarkId}"]`));
  } else {
    record('removeMark removes the dispatchAsk span', false, 'no surviving ask mark id to remove');
  }

  // --- 6. setReadOnly toggles editability ---
  handleA.setReadOnly(true);
  record('setReadOnly(true) makes the view non-editable', handleA.view.editable === false);
  handleA.setReadOnly(false);
  record('setReadOnly(false) restores editability', handleA.view.editable === true);

  // --- 7. margin mode: onMarkClick / onMarkHover / markOffsets, no popover chrome ---
  const popoverChromeCount = document.querySelectorAll('.mark-popover, .mark-popover-backdrop, .mark-mobile-strip').length;
  const clicks: string[] = [];
  const hovers: Array<string | null> = [];
  const handleC = await createProofEditor(document.getElementById('editor-c')!, {
    ydoc: docB,
    awareness: null,
    user: { name: 'Cleo', color: '#10b981' },
    onMarkAction: async (action) => {
      markActionsA.push(action);
    },
    onMarkClick: (markId) => clicks.push(markId),
    onMarkHover: (markId) => hovers.push(markId),
  });
  const cRange = findTextRange(handleC.view, 'Hello world');
  if (!cRange) throw new Error('editor C has no text');
  handleC.view.dispatch(handleC.view.state.tr.setSelection(TextSelection.create(handleC.view.state.doc, cRange.from, cRange.to)));
  handleC.view.focus();
  await sleep(100);
  const cCommentButton = Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-c .dispatch-action-bar button'))
    .find((button) => button.textContent === 'Comment');
  cCommentButton?.click();
  await sleep(300);
  const cAction = markActionsA[markActionsA.length - 1];
  const cMarkId = cAction && 'markId' in cAction ? cAction.markId : null;
  const cSpan = cMarkId ? document.querySelector<HTMLElement>(`#editor-c [data-id="${cMarkId}"]`) : null;
  const cSecondRange = findTextRange(handleC.view, 'the plan');
  if (!cSecondRange) throw new Error('editor C has no second text range');
  handleC.view.dispatch(handleC.view.state.tr.setSelection(TextSelection.create(handleC.view.state.doc, cSecondRange.from, cSecondRange.to)));
  handleC.view.focus();
  await sleep(100);
  cCommentButton?.click();
  await sleep(300);
  const cSecondAction = markActionsA[markActionsA.length - 1];
  const cSecondMarkId = cSecondAction && 'markId' in cSecondAction ? cSecondAction.markId : null;
  await waitForPlaywrightAction('hover');
  await sleep(100);
  const hoverReportsEnterAndLeave = !!cMarkId && hovers[0] === cMarkId && hovers[hovers.length - 1] === null;
  await waitForPlaywrightAction('click');
  await sleep(100);
  record(
    'onMarkClick reports the clicked mark id',
    !!cMarkId && clicks.includes(cMarkId),
    JSON.stringify({ button: !!cCommentButton, action: cAction, span: !!cSpan, clicks }),
  );
  record('onMarkHover reports enter and leave', hoverReportsEnterAndLeave, JSON.stringify(hovers));
  const markOffsetsCandidate: unknown = handleC;
  let offsetOrderMatchesDocument = false;
  if (
    typeof markOffsetsCandidate === 'object'
    && markOffsetsCandidate !== null
    && 'markOffsets' in markOffsetsCandidate
    && typeof markOffsetsCandidate.markOffsets === 'function'
  ) {
    const offsets = markOffsetsCandidate.markOffsets();
    if (offsets instanceof Map && cMarkId && cSecondMarkId && cSpan) {
      const expectedOffset = cSpan.getBoundingClientRect().top - document.getElementById('editor-c')!.getBoundingClientRect().top;
      const firstOffset = offsets.get(cMarkId);
      const secondOffset = offsets.get(cSecondMarkId);
      offsetOrderMatchesDocument = typeof firstOffset === 'number'
        && typeof secondOffset === 'number'
        && Math.abs(firstOffset - expectedOffset) < 1
        && firstOffset <= secondOffset
        && [...offsets.keys()].indexOf(cMarkId) < [...offsets.keys()].indexOf(cSecondMarkId);
    }
  }
  record('markOffsets reports highlights in document order', offsetOrderMatchesDocument);
  record(
    'margin mode renders no popover chrome',
    document.querySelectorAll('.mark-popover, .mark-popover-backdrop, .mark-mobile-strip').length === popoverChromeCount,
  );
  record('root carries the proof-editor scope class', document.getElementById('editor-c')!.classList.contains('proof-editor'));

  // --- 8. popover mode (a second editor on docB): Reply text reaches onMarkAction ---
  const replies: MarkAction[] = [];
  const rootB2 = document.getElementById('editor-b')!.appendChild(document.createElement('div'));
  rootB2.id = 'editor-b2';
  const handleB2 = await createProofEditor(rootB2, {
    ydoc: docB,
    awareness: null,
    user: { name: 'Bob', color: '#3b82f6' },
    onMarkAction: async (action) => {
      replies.push(action);
    },
  });
  if (cMarkId) {
    // Thread metadata normally arrives through the host's marks projection; feed it the way a host would.
    handleB2.applyRemoteMarks({
      [cMarkId]: {
        kind: 'comment',
        by: 'human:Cleo',
        createdAt: new Date().toISOString(),
        quote: 'Hello world',
        range: cRange,
        text: 'Initial comment',
        thread: cMarkId,
        resolved: false,
        replies: [],
      },
    }, { hydrateAnchors: false });
  }
  await sleep(100);
  const bSpan = cMarkId ? handleB2.view.dom.querySelector<HTMLElement>(`[data-mark-id="${cMarkId}"]`) : null;
  if (!bSpan) throw new Error('popover editor has no comment span');
  await waitForPlaywrightAction('click');
  await sleep(200);
  const replyBox = document.querySelector<HTMLTextAreaElement>('.mark-popover textarea');
  if (replyBox) {
    replyBox.value = 'reply text';
    replyBox.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const replyButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.mark-popover button'))
    .find((button) => button.textContent === 'Reply');
  replyButton?.click();
  await sleep(200);
  record(
    'popover Reply carries its text through onMarkAction',
    replies.some((action) => action.kind === 'reply' && 'text' in action && action.text === 'reply text'),
    JSON.stringify({ replyBox: !!replyBox, replyButton: !!replyButton, disabled: replyButton?.disabled, replies }),
  );
  const authoredTree = JSON.stringify(docA.getXmlFragment('prosemirror').toJSON());
  // --- 9. typing remains live after a remote edit and remote cursor decoration ---
  handleA.setMarkdown('## Database\n\nUse SQLite\n\n```ts\nconst x = 1;\n```\n');
  await sleep(200);
  await waitForPlaywrightAction('type-remote');
  await sleep(400);
  record(
    'typing in B after a remote edit appears in A',
    handleA.view.state.doc.textContent.includes('hello from B'),
  );
  handleB2.destroy();

  // --- 10. setMarkdown replaces the document ---
  const setMarkdownCandidate: unknown = handleC;
  if (
    typeof setMarkdownCandidate === 'object'
    && setMarkdownCandidate !== null
    && 'setMarkdown' in setMarkdownCandidate
    && typeof setMarkdownCandidate.setMarkdown === 'function'
  ) {
    setMarkdownCandidate.setMarkdown('# Title\n\nBody paragraph.');
    await sleep(100);
    record('setMarkdown renders parsed markdown', !!handleC.view.dom.querySelector('h1') && handleC.view.dom.textContent!.includes('Body paragraph.'));
    // Soft breaks are an import-time transform: setMarkdown joins them with a space...
    setMarkdownCandidate.setMarkdown('First soft line\ncontinues here.');
    await sleep(100);
    record(
      'setMarkdown joins a soft line break with a space',
      handleC.view.state.doc.textContent === 'First soft line continues here.',
      JSON.stringify({ text: handleC.view.state.doc.textContent, json: handleC.view.state.doc.toJSON() }),
    );
    // ...while a text/plain paste, which goes through the editor's shared parser, keeps its line break.
    const pasteData = new DataTransfer();
    pasteData.setData('text/plain', 'alpha\nbeta');
    handleC.view.focus();
    handleC.view.dispatch(handleC.view.state.tr.setSelection(TextSelection.atEnd(handleC.view.state.doc)));
    handleC.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: pasteData, bubbles: true, cancelable: true }));
    await sleep(150);
    record(
      'a text/plain paste keeps its line break',
      handleC.view.state.doc.textContent.includes('alpha\nbeta'),
      handleC.view.state.doc.textContent,
    );
  } else {
    record('setMarkdown renders parsed markdown', false, 'method is absent');
  }
  // --- 11. scoped CSS: the page body is untouched; the actor is the user ---
  record('lib.css leaves body alone', getComputedStyle(document.body).marginTop === '8px');
  await sleep(200);
  record('typing is authored by human:<user>', authoredTree.includes('human:Alice'), authoredTree);
  handleC.destroy();
  Object.assign(window, {
    __smokeResults: results,
    __smokeHandles: { handleA, handleB, docA, docB, Y },
  });
  log('DONE');
}

interface TwoContextEditor {
  applyAwareness(update: number[]): void;
  applyDocument(update: number[]): void;
  awarenessUpdate(): number[];
  documentUpdate(): number[];
  handle: ProofEditorHandle;
}

async function twoContextMain(): Promise<void> {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const query = new URLSearchParams(window.location.search);
  const documentUpdate = query.get('document');
  if (documentUpdate !== null) {
    Y.applyUpdate(doc, new Uint8Array(JSON.parse(documentUpdate)), 'relay');
  }
  const awarenessUpdate = query.get('awareness');
  if (awarenessUpdate !== null) {
    applyAwarenessUpdate(awareness, new Uint8Array(JSON.parse(awarenessUpdate)), 'relay');
  }
  const handle = await createProofEditor(document.getElementById('editor-a')!, {
    awareness,
    user: { name: 'Smoke', color: '#3b82f6' },
    ydoc: doc,
  });
  const target = window as Window & { __twoContextEditor?: TwoContextEditor };
  target.__twoContextEditor = {
    applyAwareness(update) {
      applyAwarenessUpdate(awareness, new Uint8Array(update), 'relay');
    },
    applyDocument(update) {
      Y.applyUpdate(doc, new Uint8Array(update), 'relay');
    },
    awarenessUpdate() {
      return Array.from(encodeAwarenessUpdate(awareness, [...awareness.getStates().keys()]));
    },
    documentUpdate() {
      return Array.from(Y.encodeStateAsUpdate(doc));
    },
    handle,
  };
}

const pageQuery = new URLSearchParams(window.location.search);
const run = pageQuery.has('two-context') ? twoContextMain : main;
run().catch((error) => {
  log(`FATAL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  Object.assign(window, {
    __smokeResults: results,
    __smokeFatal: error instanceof Error ? error.message : String(error),
  });
});
