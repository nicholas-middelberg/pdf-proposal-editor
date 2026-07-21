import { labelBlocks } from '../lib/blockLabels';
import type { Block } from '../lib/types';
import { ParagraphBlock } from './ParagraphBlock';

type DocumentViewProps = {
  blocks: Block[];
  /** Task 7 passes EditableParagraph here; defaults to the plain read-only
   * ParagraphBlock for callers (and tests) that don't need editing. */
  renderParagraph?: (block: Block, heading: string | null, index: number) => React.ReactNode;
};

/** Renders blocks in document order. Headings are navigation/grouping only
 * (D-002) — plain markup here, no click behavior. Each paragraph also gets
 * its nearest-preceding-heading text + running index (visual redesign) for
 * the on-page mono label, via lib/blockLabels.ts. */
export function DocumentView({ blocks, renderParagraph }: DocumentViewProps) {
  const labels = labelBlocks(blocks);
  return (
    <div className="document-view">
      {blocks.map((block) => {
        if (block.type === 'heading') {
          return (
            <h2 key={block.id} className="document-heading">
              {block.text}
            </h2>
          );
        }
        const { heading, index } = labels.get(block.id) ?? { heading: null, index: 0 };
        return (
          <div key={block.id} className="paragraph-container">
            {renderParagraph ? (
              renderParagraph(block, heading, index)
            ) : (
              <ParagraphBlock block={block} heading={heading} index={index} />
            )}
          </div>
        );
      })}
    </div>
  );
}
