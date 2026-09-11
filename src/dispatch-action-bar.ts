/**
 * Standalone selection-action bar: Comment / Suggest / Ask.
 *
 * ./editor/plugins/mark-selection-bar.ts has no extension point — its button
 * set (Comment/Flag/Suggest) is built by a private `buildButtons()` method
 * with no registration hook, and its Comment/Suggest buttons call
 * `openCommentComposer`/`suggestReplace` directly and unconditionally, with
 * no `window.proof`-style seam of the kind mark-popover.ts has. Wrapping that
 * file's exported plugin cannot add an Ask button to it, and cannot make its
 * existing buttons fire `onMarkAction` after creating a fresh mark without
 * either editing it or fighting its internal DOM/state to detect "this specific
 * click just created this specific mark".
 *
 * This module is a full replacement, registered instead of (not alongside)
 * `markSelectionBarPlugin`, that mirrors its lifecycle logic — but always
 * centers the bar on the selection instead of docking it in the editor's
 * gutter, per product feedback that a docked bar reads as disconnected from
 * the text it acts on — and
 * implements exactly the three MarkAction kinds the contract defines for the
 * selection bar: Comment, Suggest, and Ask (dropping the upstream bar's Flag
 * button, which has no corresponding MarkAction kind). Each button applies
 * the underlying mark locally with a freshly generated id — a comment mark
 * with empty body text, a replace-suggestion mark with empty replacement
 * content, or a fresh dispatchAsk mark — then calls `onMarkAction`; a Dispatch
 * host is expected to collect the actual comment/suggestion body through its
 * own UI, correlated by `markId`. If the hook's promise rejects, the local
 * mark is removed.
 */

import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';

import { comment, suggestReplace, deleteMark } from './editor/plugins/marks';
import type { MarkRange } from './editor/plugins/marks';
import { createAskMark, removeAskMark } from './dispatch-marks';
import type { MarkAction, SelectionBarActionKind } from './dispatch-marks';

const actionBarKey = new PluginKey('dispatch-action-bar');
const MARGIN = 12;

export interface ActionBarOptions {
  by: string;
  onMarkAction?: (action: MarkAction) => void | Promise<void>;
}

function getSelectionRange(view: EditorView): MarkRange | null {
  const { from, to } = view.state.selection;
  if (from === to) return null;
  return { from, to };
}

function isRangeValid(view: EditorView, range: MarkRange | null): range is MarkRange {
  if (!range) return false;
  return range.from >= 0 && range.to > range.from && range.to <= view.state.doc.content.size;
}

function getAnchorBox(view: EditorView, range: MarkRange) {
  const from = view.coordsAtPos(range.from);
  const to = view.coordsAtPos(range.to);
  return {
    top: Math.min(from.top, to.top),
    bottom: Math.max(from.bottom, to.bottom),
    left: Math.min(from.left, to.left),
    right: Math.max(from.right, to.right),
  };
}

/** Centers the bar horizontally on the selection's anchor box, clamped to the
 *  viewport by MARGIN, and places it above the selection when there's room,
 *  else below, else clamped to the viewport — always near the selection
 *  rather than docked in the editor's gutter (mark-selection-bar.ts's
 *  positioning behavior, which this deliberately does not mirror). */
export function positionBar(bar: HTMLElement, view: EditorView, range: MarkRange): void {
  try {
    const anchorBox = getAnchorBox(view, range);
    if (typeof bar.getBoundingClientRect !== 'function') return;
    const barRect = bar.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const maxTop = Math.max(MARGIN, viewportH - barRect.height - MARGIN);

    const aboveTop = anchorBox.top - barRect.height - MARGIN;
    const belowTop = anchorBox.bottom + MARGIN;
    const hasRoomAbove = aboveTop >= MARGIN;
    const hasRoomBelow = belowTop + barRect.height <= viewportH - MARGIN;
    const top = hasRoomAbove ? aboveTop : hasRoomBelow ? belowTop : Math.max(MARGIN, Math.min(anchorBox.top, maxTop));
    const center = (anchorBox.left + anchorBox.right) / 2;
    const left = Math.max(MARGIN, Math.min(center - barRect.width / 2, viewportW - barRect.width - MARGIN));
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
  } catch {
    // Ignore positioning errors for invalid positions (e.g. detached view mid-teardown).
  }
}

class ActionBarController {
  private view: EditorView;
  private readonly bar: HTMLDivElement;
  private lastRange: MarkRange | null = null;
  private readonly options: ActionBarOptions;

  private readonly handleSelectionChange = () => {
    const range = getSelectionRange(this.view);
    if (range) this.lastRange = range;
  };

  private readonly handleScroll = () => {
    if (this.lastRange) positionBar(this.bar, this.view, this.lastRange);
  };

  constructor(view: EditorView, options: ActionBarOptions) {
    this.view = view;
    this.options = options;
    this.bar = document.createElement('div');
    this.bar.className = 'dispatch-action-bar';
    this.bar.style.display = 'none';
    this.bar.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    const container = view.dom.parentElement ?? document.body;
    container.appendChild(this.bar);
    this.buildButtons();

    document.addEventListener('selectionchange', this.handleSelectionChange);
    window.addEventListener('scroll', this.handleScroll, true);
    window.addEventListener('resize', this.handleScroll);
  }

  destroy(): void {
    document.removeEventListener('selectionchange', this.handleSelectionChange);
    window.removeEventListener('scroll', this.handleScroll, true);
    window.removeEventListener('resize', this.handleScroll);
    this.bar.remove();
  }

  update(view: EditorView): void {
    this.view = view;
    const range = getSelectionRange(view);
    if (!range) {
      this.bar.style.display = 'none';
      return;
    }
    this.lastRange = range;
    this.bar.style.display = 'flex';
    positionBar(this.bar, view, range);
  }

  private async runAction(kind: SelectionBarActionKind, range: MarkRange): Promise<void> {
    const quote = this.view.state.doc.textBetween(range.from, range.to, '\n', '\n');
    let markId: string;

    if (kind === 'comment') {
      markId = comment(this.view, quote, this.options.by, '', range).id;
    } else if (kind === 'suggest') {
      const mark = suggestReplace(this.view, quote, this.options.by, '', range);
      if (!mark) return;
      markId = mark.id;
    } else {
      const created = createAskMark(this.view, range, this.options.by);
      if (!created) return;
      markId = created.id;
    }

    const onMarkAction = this.options.onMarkAction;
    if (!onMarkAction) return;

    const action: MarkAction = { kind, markId, quote, from: range.from, to: range.to };
    try {
      await onMarkAction(action);
    } catch (error) {
      if (kind === 'ask') removeAskMark(this.view, markId);
      else deleteMark(this.view, markId);
      console.warn(`[@sjawhar/proof-editor] onMarkAction(${kind}) rejected; removed the local mark`, error);
    }
  }

  private buildButtons(): void {
    this.bar.innerHTML = '';

    const makeButton = (label: string, kind: SelectionBarActionKind) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      button.addEventListener('click', () => {
        const range = isRangeValid(this.view, this.lastRange) ? this.lastRange : getSelectionRange(this.view);
        if (!range) return;
        void this.runAction(kind, range);
      });
      return button;
    };

    this.bar.appendChild(makeButton('Comment', 'comment'));
    this.bar.appendChild(makeButton('Suggest', 'suggest'));
    this.bar.appendChild(makeButton('Ask', 'ask'));
  }
}

export const dispatchActionBarPlugin = (options: ActionBarOptions) =>
  $prose(() => {
    return new Plugin({
      key: actionBarKey,
      view(view) {
        return new ActionBarController(view, options);
      },
    });
  });
