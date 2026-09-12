import { $remark } from '@milkdown/kit/utils';
import remarkDirective from 'remark-directive';

import { remarkTypedBlocks, type BlockSchema } from './block-schema.js';

export const libraryRemarkDirectivePlugin = $remark(
  'remarkDirective',
  () => remarkDirective,
  { collapseEmptyAttributes: false, preferShortcut: true },
);

export function typedBlockRemarkPlugin(schema: BlockSchema) {
  return $remark('remarkTypedBlocks', () => () => remarkTypedBlocks(schema));
}
