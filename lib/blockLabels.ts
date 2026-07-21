// Presentation-only derivation (visual redesign): each paragraph's on-page
// mono label is its nearest preceding heading's text, plus its running
// position among paragraphs in the whole document. Shared by DocumentView
// (on-page labels) and HistoryPanel (revision "section" field) so both stay
// consistent without duplicating the walk.

import type { Block } from './types';

export type BlockLabel = {
  /** Nearest preceding heading's text, or null if no heading precedes it. */
  heading: string | null;
  /** 1-based position among paragraph blocks in the whole document. */
  index: number;
};

export function labelBlocks(blocks: Block[]): Map<string, BlockLabel> {
  const labels = new Map<string, BlockLabel>();
  let heading: string | null = null;
  let index = 0;

  for (const block of blocks) {
    if (block.type === 'heading') {
      heading = block.text;
      continue;
    }
    index += 1;
    labels.set(block.id, { heading, index });
  }

  return labels;
}
