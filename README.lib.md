# @sjawhar/proof-editor

A standalone, embeddable build of [Proof](https://github.com/everyinc/proof-sdk)'s collaborative
Milkdown/ProseMirror editor — the mark/collab/heatmap plugin stack, without Proof's own app shell,
auth, websocket bridge, or analytics. You bring a [Yjs](https://yjs.dev) document (and, optionally,
an [Awareness](https://github.com/yjs/y-protocols) instance) and get back an editor bound to it,
plus a hook for turning user actions on comments, suggestions, and a new "ask" mark into calls
against your own backend instead of local, unconditional document mutations.

A companion `@sjawhar/proof-editor/headless` entry point exposes the same ProseMirror schema for
Node/Bun: parse and serialize markdown without a DOM, for servers that need to read or write
documents this editor can open.

## Usage

```ts
import { createProofEditor } from '@sjawhar/proof-editor';
import '@sjawhar/proof-editor/style.css';

const handle = await createProofEditor(document.getElementById('editor')!, {
  ydoc,
  awareness,
  user: { name: 'Ada', color: '#ef4444' },
  onMarkAction: async (action) => {
    await fetch('/api/mark-actions', { method: 'POST', body: JSON.stringify(action) });
  },
});
```

```ts
import { createHeadlessProof } from '@sjawhar/proof-editor/headless';

const { schema, parseMarkdown, serializeMarkdown } = await createHeadlessProof();
const doc = parseMarkdown('# Hello\n\nSome **bold** text.');
console.log(serializeMarkdown(doc));
```

## API

```ts
export interface ProofEditorUser {
  name: string;
  color: string;
}

export type MarkAction =
  | { kind: 'comment' | 'ask' | 'suggest'; markId: string; quote: string; from: number; to: number }
  | { kind: 'reply' | 'resolve' | 'accept' | 'reject'; markId: string };

export interface CreateProofEditorOptions {
  ydoc: Y.Doc;
  awareness?: Awareness | null;
  user: ProofEditorUser;
  readOnly?: boolean;
  onMarkAction?: (action: MarkAction) => void | Promise<void>;
  heatMapMode?: 'hidden' | 'subtle' | 'background' | 'full';
}

export interface ProofEditorHandle {
  view: EditorView;
  getMarkdown(): string;
  setReadOnly(readOnly: boolean): void;
  applyRemoteMarks(metadata: Record<string, StoredMark>, options?: { hydrateAnchors?: boolean }): void;
  removeMark(markId: string): void;
  focusMark(markId: string): void;
  destroy(): void;
}

export function createProofEditor(root: HTMLElement, opts: CreateProofEditorOptions): Promise<ProofEditorHandle>;
```

For the selection-bar actions (`comment` | `ask` | `suggest`), the editor has already applied the
mark locally to `[from, to]` with a fresh `markId` before `onMarkAction` is called; if the returned
promise rejects, the local mark is removed. For the popover actions (`reply` | `resolve` | `accept`
| `reject`), no local mutation is applied — the host is expected to mutate its own store and let the
change arrive back through the shared `Y.Doc`.

```ts
export interface HeadlessProofEditor {
  schema: Schema;
  parseMarkdown(markdown: string): ProseMirrorNode;
  serializeMarkdown(doc: ProseMirrorNode): string;
}

export function createHeadlessProof(): Promise<HeadlessProofEditor>;
```

## Attribution

Built on [Every](https://every.to)'s [Proof SDK](https://github.com/everyinc/proof-sdk), MIT
licensed. "Proof" is a product of Every; this package is an independent, unaffiliated build of its
open-source editor core and is not the hosted Proof product.
