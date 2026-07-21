// Rebuilds Block[] from an AI re-detect response (D-003). The model only
// chooses groupings + reading order over items WE supply — it never gets to
// invent block text itself, so a bad response can misorder/misgroup but
// can't hallucinate new paragraph content into the document.

import { assignBlockIds } from '../id';
import type { BBox, Block, BlockType, PositionedItem } from '../types';

type RedetectGroup = { type: unknown; itemIndices: unknown };

function blockFromItems(
  type: BlockType,
  groupItems: PositionedItem[],
): { type: BlockType; text: string; page: number; bbox: BBox } | null {
  const text = groupItems
    .map((it) => it.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;

  const bbox = groupItems.reduce<BBox>(
    (acc, it) => [
      Math.min(acc[0], it.bbox[0]),
      Math.min(acc[1], it.bbox[1]),
      Math.max(acc[2], it.bbox[2]),
      Math.max(acc[3], it.bbox[3]),
    ],
    groupItems[0].bbox,
  );
  return { type, text, page: groupItems[0].page, bbox };
}

/**
 * Rejects outright (null) on anything that signals real corruption risk: an
 * invalid shape/type, an out-of-range index, or an index claimed by more
 * than one group. A gap — an index the model never assigned to any group,
 * observed in practice on larger documents — is NOT rejected: that item is
 * emitted as its own one-item paragraph block at its natural position
 * instead. Never silently dropping text outranks a clean grouping for every
 * item; this only degrades segmentation quality for the missed few, it
 * never loses content or fails a request that was otherwise fine.
 */
export function reconstructBlocks(items: PositionedItem[], groups: unknown): Block[] | null {
  if (!Array.isArray(groups) || groups.length === 0) return null;

  const groupOfIndex = new Map<number, number>();
  const parsedGroups: { type: BlockType; itemIndices: number[] }[] = [];

  for (const g of groups as RedetectGroup[]) {
    if (!g || typeof g !== 'object') return null;
    const { type, itemIndices } = g;
    if (type !== 'heading' && type !== 'paragraph') return null;
    if (!Array.isArray(itemIndices) || itemIndices.length === 0) return null;

    const groupIndex = parsedGroups.length;
    for (const idx of itemIndices) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= items.length || groupOfIndex.has(idx)) {
        return null; // out of range or claimed twice — a real corruption signal
      }
      groupOfIndex.set(idx, groupIndex);
    }
    parsedGroups.push({ type, itemIndices });
  }

  // Walk items in original order, emitting each group in full the first time
  // any of its indices is reached (preserving the model's chosen order
  // within the group — this is what makes multi-column reordering work), and
  // filling in any index the model missed as its own paragraph.
  const raw: { type: BlockType; text: string; page: number; bbox: BBox }[] = [];
  const emittedGroups = new Set<number>();

  for (let i = 0; i < items.length; i++) {
    const groupIndex = groupOfIndex.get(i);
    if (groupIndex === undefined) {
      const block = blockFromItems('paragraph', [items[i]]);
      if (block) raw.push(block);
      continue;
    }
    if (emittedGroups.has(groupIndex)) continue; // already emitted via an earlier member
    emittedGroups.add(groupIndex);
    const group = parsedGroups[groupIndex];
    const block = blockFromItems(group.type, group.itemIndices.map((idx) => items[idx]));
    if (block) raw.push(block);
  }

  if (raw.length === 0) return null;
  return assignBlockIds(raw);
}
