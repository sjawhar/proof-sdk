import { positionBar } from '../dispatch-action-bar.js';
import type { MarkRange } from '../editor/plugins/marks.js';
import type { EditorView } from '@milkdown/kit/prose/view';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(error as Error).message}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function withMockWindow<T>(windowLike: { innerWidth: number; innerHeight: number }, fn: () => T): T {
  const g = globalThis as { window?: unknown };
  const prevWindow = g.window;
  g.window = windowLike;
  try {
    return fn();
  } finally {
    if (prevWindow === undefined) {
      delete g.window;
    } else {
      g.window = prevWindow;
    }
  }
}

type Box = { top: number; bottom: number; left: number; right: number };

function makeBar(rect: { width: number; height: number }): HTMLElement {
  const style: Record<string, string> = {};
  return {
    style,
    getBoundingClientRect: () => ({ ...rect, top: 0, bottom: rect.height, left: 0, right: rect.width }),
  } as unknown as HTMLElement;
}

// The editor rect only bounds the bar vertically (it must never rise above the
// editor's top edge); there is no gutter to dock into.
function makeView(coords: { from: Box; to: Box }, editor: Box = { top: 0, bottom: 10_000, left: 0, right: 10_000 }): EditorView {
  return {
    dom: { getBoundingClientRect: () => editor },
    coordsAtPos: (pos: number) => (pos === 0 ? coords.from : coords.to),
  } as unknown as EditorView;
}

console.log('\n=== dispatch-action-bar positionBar ===');

test('centers the bar on the selection, above it, on a wide viewport with room on both sides', () => {
  // A selection from x 379-600 sitting comfortably inside a 1600px viewport —
  // the gutter-docking branch used to place the bar at a fixed offset past
  // the editor's right edge regardless of where the selection was; it must
  // now land near the selection instead.
  const selection: Box = { top: 200, bottom: 220, left: 379, right: 600 };
  const view = makeView({ from: selection, to: selection });
  const bar = makeBar({ width: 120, height: 40 });
  const range: MarkRange = { from: 0, to: 1 };

  withMockWindow({ innerWidth: 1600, innerHeight: 900 }, () => {
    positionBar(bar, view, range);
  });

  const barLeft = parseFloat(bar.style.left);
  const barTop = parseFloat(bar.style.top);
  const barWidth = 120;
  const barHeight = 40;
  const selectionCenterX = (selection.left + selection.right) / 2;
  const barCenterX = barLeft + barWidth / 2;

  assert(
    Math.abs(barCenterX - selectionCenterX) <= 8,
    `Expected bar center x within 8px of selection center x (${selectionCenterX}), got ${barCenterX}`,
  );
  assert(
    barTop + barHeight <= selection.top,
    `Expected the bar to sit above the selection (bar bottom ${barTop + barHeight} <= selection top ${selection.top})`,
  );
});

test('never docks in the gutter even when there is ample room past where an editor edge would be', () => {
  // Previously: spaceRight/spaceLeft measured against view.dom's rect, and a
  // wide gap on either side triggered docking at editorRect.right/left +
  // DOCK_GAP. The view here has no dom rect at all — if positionBar tried to
  // read one, this would throw inside the try/catch and leave bar.style
  // unset, which the assertions below would catch.
  const selection: Box = { top: 300, bottom: 320, left: 40, right: 90 };
  const view = makeView({ from: selection, to: selection });
  const bar = makeBar({ width: 100, height: 32 });
  const range: MarkRange = { from: 0, to: 1 };

  withMockWindow({ innerWidth: 1600, innerHeight: 900 }, () => {
    positionBar(bar, view, range);
  });

  assert(bar.style.left !== undefined && bar.style.left !== '', 'Expected positionBar to set a left offset');
  const barLeft = parseFloat(bar.style.left);
  const selectionCenterX = (selection.left + selection.right) / 2;
  assert(
    Math.abs(barLeft + 50 - selectionCenterX) <= 8,
    `Expected the bar centered near the selection (left edge), got left=${barLeft}`,
  );
});

test('falls back to below the selection when there is no room above', () => {
  const selection: Box = { top: 5, bottom: 25, left: 700, right: 900 };
  const view = makeView({ from: selection, to: selection });
  const bar = makeBar({ width: 120, height: 40 });
  const range: MarkRange = { from: 0, to: 1 };

  withMockWindow({ innerWidth: 1600, innerHeight: 900 }, () => {
    positionBar(bar, view, range);
  });

  const barTop = parseFloat(bar.style.top);
  assert(barTop >= selection.bottom, `Expected the bar below the selection, got top=${barTop}`);
});

test('never rises above the editor: a first-line selection puts the bar below it, not over the host chrome', () => {
  // Host layout: tabs at y 175-219, editor starting at y 230, selection on the first line.
  const selection: Box = { top: 235, bottom: 254, left: 427, right: 470 };
  const editor: Box = { top: 230, bottom: 900, left: 344, right: 1192 };
  const view = makeView({ from: selection, to: selection }, editor);
  const bar = makeBar({ width: 195, height: 36 });
  const range: MarkRange = { from: 0, to: 1 };

  withMockWindow({ innerWidth: 1280, innerHeight: 720 }, () => {
    positionBar(bar, view, range);
  });

  const barTop = parseFloat(bar.style.top);
  assert(barTop >= editor.top, `Expected the bar inside the editor (top >= ${editor.top}), got top=${barTop}`);
  assert(barTop >= selection.bottom, `Expected the bar below the first-line selection, got top=${barTop}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
