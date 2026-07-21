import type { Block } from '../lib/types';

type ParagraphBlockProps = {
  block: Block;
  /** Nearest preceding heading's text (lib/blockLabels.ts), or null. */
  heading?: string | null;
  /** Running position among paragraphs in the whole document. */
  index?: number;
};

/** Renders one paragraph. The paragraph is the editable unit (D-002) — this
 * component is presentational only for now; Task 7 adds selection/editing. */
export function ParagraphBlock({ block, heading, index }: ParagraphBlockProps) {
  return (
    <>
      {index !== undefined && (
        <p className="block-label">
          <span className="idx">{String(index).padStart(2, '0')}</span>
          {heading}
        </p>
      )}
      <p className="block-body" data-block-id={block.id}>
        {block.text}
      </p>
    </>
  );
}
