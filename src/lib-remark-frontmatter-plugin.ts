import type { MilkdownPlugin } from '@milkdown/ctx';
import { $remark } from '@milkdown/kit/utils';
import remarkFrontmatter from 'remark-frontmatter';

export const libraryRemarkFrontmatterPlugin: MilkdownPlugin = $remark(
  'remarkFrontmatter',
  () => remarkFrontmatter,
  ['yaml'],
);
