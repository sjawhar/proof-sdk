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
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
  const handleB: ProofEditorHandle = await createProofEditor(rootB, {
    ydoc: docB,
    awareness: awarenessB,
    user: { name: 'Bob', color: '#3b82f6' },
  });
  record('both editors created', true);

  // --- 1. seed content in A by typing (dispatching a real ProseMirror transaction) ---
  handleA.view.dispatch(handleA.view.state.tr.insertText('Hello world, this is bold text about the plan.'));
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
  await sleep(12000);
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

  (window as unknown as Record<string, unknown>).__smokeResults = results;
  (window as unknown as Record<string, unknown>).__smokeHandles = { handleA, handleB, docA, docB, Y };
  log('DONE');
}

main().catch((error) => {
  log(`FATAL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  (window as unknown as Record<string, unknown>).__smokeResults = results;
  (window as unknown as Record<string, unknown>).__smokeFatal = error instanceof Error ? error.message : String(error);
});
