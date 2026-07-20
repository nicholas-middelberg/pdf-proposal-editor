import type { Block } from '../lib/types';
import { ParagraphBlock } from './ParagraphBlock';

type DocumentViewProps = {
  blocks: Block[];
  /** Task 7 passes EditableParagraph here; defaults to the plain read-only
   * ParagraphBlock for callers (and tests) that don't need editing. */
  renderParagraph?: (block: Block) => React.ReactNode;
};

/** Renders blocks in document order. Headings are navigation/grouping only
 * (D-002) — plain markup here, no click behavior. */
export function DocumentView({ blocks, renderParagraph }: DocumentViewProps) {
  return (
    <div className="document-view">
      {blocks.map((block) =>
        block.type === 'heading' ? (
          <h2 key={block.id} className="document-heading">
            {block.text}
          </h2>
        ) : (
          <div key={block.id} className="paragraph-container">
            {renderParagraph ? renderParagraph(block) : <ParagraphBlock block={block} />}
          </div>
        ),
      )}
    </div>
  );
}
