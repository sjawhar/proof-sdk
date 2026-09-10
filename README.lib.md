# @sjawhar/proof-editor

A standalone, embeddable build of [Proof](https://github.com/everyinc/proof-sdk)'s collaborative
Milkdown/ProseMirror editor — the mark/collab/heatmap plugin stack, without Proof's own app shell,
auth, websocket bridge, or analytics. You bring a [Yjs](https://yjs.dev) document (and, optionally,
an [Awareness](https://github.com/yjs/y-protocols) instance) and get back an editor bound to it,
plus a hook for turning user actions on comments, suggestions, and an "ask" mark into calls
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

export type SelectionBarActionKind = 'comment' | 'ask' | 'suggest';
export type PopoverActionKind = 'reply' | 'resolve' | 'unresolve' | 'accept' | 'reject' | 'delete';
export type MarkAction =
  | { kind: SelectionBarActionKind; markId: string; quote: string; from: number; to: number }
  | { kind: 'reply'; markId: string; text: string }
  | { kind: Exclude<PopoverActionKind, 'reply'>; markId: string };

export interface CreateProofEditorOptions {
  ydoc: Y.Doc;
  awareness?: Awareness | null;
  user: ProofEditorUser;
  readOnly?: boolean;
  onMarkAction?: (action: MarkAction) => void | Promise<void>;
  onMarkClick?: (markId: string) => void;
  onMarkHover?: (markId: string | null) => void;
  heatMapMode?: 'hidden' | 'subtle' | 'background' | 'full';
}

export interface ProofEditorHandle {
  view: EditorView;
  getMarkdown(): string;
  setMarkdown(markdown: string): void;
  markOffsets(): Map<string, number>;
  setReadOnly(readOnly: boolean): void;
  applyRemoteMarks(metadata: Record<string, StoredMark>, options?: { hydrateAnchors?: boolean }): void;
  removeMark(markId: string): void;
  focusMark(markId: string): void;
  destroy(): void;
}

export function createProofEditor(root: HTMLElement, opts: CreateProofEditorOptions): Promise<ProofEditorHandle>;
```

The selection-bar actions (`comment` | `ask` | `suggest`) apply a local mark before
`onMarkAction` runs. If that promise rejects, the mark is removed. In the default popover mode,
`reply` (with its text), `resolve`, `unresolve`, `accept`, `reject`, and `delete` report through
the hook when it is present; without a hook, they use the editor's local mutation.

Providing `onMarkClick` or `onMarkHover` enables margin mode. The editor reports interactions on
mark spans, does not register the mark popover or arrow-comment composer, and leaves thread UI to
the host. `markOffsets()` returns the top offset of each distinct mark's first span relative to
the supplied root, in document order. `setMarkdown()` parses markdown with the editor schema and
replaces the current document.

```ts
export interface HeadlessProofEditor {
  schema: Schema;
  parseMarkdown(markdown: string): ProseMirrorNode;
  serializeMarkdown(doc: ProseMirrorNode): string;
}

export function createHeadlessProof(): Promise<HeadlessProofEditor>;
```

The headless entry point does not construct a browser editor or require a Yjs document.

## Attribution

Built on [Every](https://every.to)'s [Proof SDK](https://github.com/everyinc/proof-sdk), MIT
licensed. "Proof" is a product of Every; this package is an independent, unaffiliated build of its
open-source editor core and is not the hosted Proof product.
