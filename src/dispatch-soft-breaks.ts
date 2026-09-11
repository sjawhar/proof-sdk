/**
 * Normalizes CommonMark soft line breaks to a single space on markdown import.
 *
 * A soft break — a single newline inside a paragraph, as opposed to a hard
 * break formed by two trailing spaces or a backslash before the newline — is
 * defined by CommonMark to render as a space (or nothing) when the paragraph
 * is reflowed. remark-parse instead keeps it as a literal "\n" inside the
 * paragraph's "text" node value, and this library's `.ProseMirror {
 * white-space: break-spaces }` then renders every one of those characters as
 * its own visual line break. Agents that hard-wrap markdown at a fixed
 * column produce many such breaks per paragraph, so an imported document
 * renders far narrower, and with far more lines, than its author intended.
 *
 * This remark plugin walks the parsed mdast tree and replaces every "\n" in
 * a "text" node's value with a single space, leaving "code"/"inlineCode"
 * node values — which are not "text" nodes and carry newlines that are part
 * of the code itself — untouched, and leaving actual hard breaks (their own
 * "break" mdast node, never a "\n" inside a "text" node) untouched. Export
 * (ProseMirror -> markdown) is unaffected: remark-stringify always re-wraps
 * paragraph text itself, so it never emits a literal "\n" inside a "text"
 * node for this transform to see.
 */

import { $remark } from '@milkdown/kit/utils';

type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
};

function visit(node: MdastNode): void {
  if (node.type === 'code' || node.type === 'inlineCode') return;
  if (node.type === 'text') {
    if (typeof node.value === 'string') node.value = node.value.replace(/\n/g, ' ');
    return;
  }
  if (!node.children) return;
  for (const child of node.children) visit(child);
}

/** Raw remark transformer factory — use directly in a `unified()` pipeline (headless). */
export function remarkSoftBreakAsSpace() {
  return (tree: MdastNode) => {
    visit(tree);
  };
}

/** Milkdown-wrapped remark plugin — use in `.use()` alongside the other Dispatch remark plugins (browser). */
export const remarkSoftBreakAsSpacePlugin = $remark('remarkSoftBreakAsSpace', () => () => remarkSoftBreakAsSpace());
