import type { Block } from '../lib/types';
import { ParagraphBlock } from './ParagraphBlock';

type DocumentViewProps = {
  blocks: Block[];
};

/** Renders blocks in document order. Headings are navigation/grouping only
 * (D-002) — plain markup here, no click behavior. */
export function DocumentView({ blocks }: DocumentViewProps) {
  return (
    <div className="document-view">
      {blocks.map((block) =>
        block.type === 'heading' ? (
          <h2 key={block.id} className="document-heading">
            {block.text}
          </h2>
        ) : (
          <ParagraphBlock key={block.id} block={block} />
        ),
      )}
    </div>
  );
}
