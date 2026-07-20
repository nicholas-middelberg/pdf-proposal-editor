import type { Block } from '../lib/types';

type ParagraphBlockProps = {
  block: Block;
};

/** Renders one paragraph. The paragraph is the editable unit (D-002) — this
 * component is presentational only for now; Task 7 adds selection/editing. */
export function ParagraphBlock({ block }: ParagraphBlockProps) {
  return (
    <p className="paragraph-block" data-block-id={block.id}>
      {block.text}
    </p>
  );
}
