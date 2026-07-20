// Core interfaces (SPECS.md → "Key interfaces"). Pinned in Task 1 because
// everything downstream keys on Block.id (D-015).

export type BlockType = 'heading' | 'paragraph';

export type BBox = [number, number, number, number];

/**
 * A parsed block. `id` is CONTENT-DERIVED (hash of text + page), never
 * positional (D-015) — array indices break when a re-detect merges/splits
 * paragraphs. See lib/id.ts.
 */
export type Block = {
  id: string;
  type: BlockType;
  text: string;
  page: number;
  bbox: BBox; // kept for the multi-column stretch (D-004); v1 ignores x.
};

/**
 * A positioned text item straight out of extraction, before segmentation.
 * "Re-detect with AI" sends these ({text, x, y}), NOT flat text (D-003).
 */
export type PositionedItem = {
  text: string;
  x: number;
  y: number;
  page: number;
  bbox: BBox;
};

export type ParseResult = {
  blocks: Block[];
  method: 'deterministic' | 'ai';
};

export type EditRequest = {
  blockId: string;
  text: string;
  instruction: string;
};

/**
 * `original` is the IMMEDIATE PRIOR text — the validation baseline — not the
 * pristine parse (D-015).
 */
export type EditProposal = {
  blockId: string;
  original: string;
  proposed: string;
};

export type HistoryEntry = {
  blockId: string;
  from: string;
  to: string;
  instruction: string;
  at: number;
};
