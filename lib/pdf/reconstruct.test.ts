import { describe, it, expect } from 'vitest';
import { reconstructBlocks } from './reconstruct';
import type { PositionedItem } from '../types';

function item(text: string, page = 1): PositionedItem {
  return { text, x: 0, y: 0, page, bbox: [0, 0, 10, 10] };
}

describe('reconstructBlocks — valid groupings', () => {
  it('rebuilds blocks in the order groups are given, joining item text', () => {
    const items = [item('Section One'), item('First'), item('sentence.'), item('Second'), item('line.')];
    const groups = [
      { type: 'heading', itemIndices: [0] },
      { type: 'paragraph', itemIndices: [1, 2] },
      { type: 'paragraph', itemIndices: [3, 4] },
    ];
    const blocks = reconstructBlocks(items, groups);
    expect(blocks).not.toBeNull();
    expect(blocks!.map((b) => b.type)).toEqual(['heading', 'paragraph', 'paragraph']);
    expect(blocks![0].text).toBe('Section One');
    expect(blocks![1].text).toBe('First sentence.');
    expect(blocks![2].text).toBe('Second line.');
  });

  it('preserves a group’s own item order even when indices are non-contiguous (multi-column reorder)', () => {
    // Simulates two interleaved columns: item 1 (left col) then item 3 (right
    // col) belong to one reading-order block, out of numeric index order.
    const items = [item('LEFT-HEADER'), item('left col line'), item('RIGHT-HEADER'), item('right col line')];
    const groups = [
      { type: 'paragraph', itemIndices: [1, 3] },
      { type: 'heading', itemIndices: [0] },
      { type: 'heading', itemIndices: [2] },
    ];
    const blocks = reconstructBlocks(items, groups);
    expect(blocks).not.toBeNull();
    const merged = blocks!.find((b) => b.type === 'paragraph');
    expect(merged!.text).toBe('left col line right col line');
  });

  it('assigns unique ids to every reconstructed block', () => {
    const items = [item('A'), item('B'), item('C')];
    const groups = [{ type: 'paragraph', itemIndices: [0, 1, 2] }];
    const blocks = reconstructBlocks(items, groups);
    expect(new Set(blocks!.map((b) => b.id)).size).toBe(blocks!.length);
  });
});

describe('reconstructBlocks — gaps are salvaged, not rejected', () => {
  it('emits an index the model never assigned to any group as its own paragraph, at its natural position', () => {
    const items = [item('First.'), item('Missed.'), item('Third.')];
    const groups = [
      { type: 'paragraph', itemIndices: [0] },
      { type: 'paragraph', itemIndices: [2] },
    ];
    const blocks = reconstructBlocks(items, groups);
    expect(blocks).not.toBeNull();
    expect(blocks!.map((b) => b.text)).toEqual(['First.', 'Missed.', 'Third.']);
    expect(blocks![1].type).toBe('paragraph'); // salvaged items are always paragraphs
  });

  it('handles a gap of several consecutive missed indices (the observed real failure)', () => {
    const items = [item('A'), item('B'), item('C'), item('D'), item('E')];
    const groups = [
      { type: 'paragraph', itemIndices: [0, 1] },
      { type: 'paragraph', itemIndices: [4] },
    ];
    const blocks = reconstructBlocks(items, groups);
    expect(blocks).not.toBeNull();
    // 0,1 grouped; 2 and 3 salvaged individually; 4 grouped — all 5 items present.
    expect(blocks!.map((b) => b.text)).toEqual(['A B', 'C', 'D', 'E']);
  });
});

describe('reconstructBlocks — real corruption signals are rejected outright', () => {
  const items = [item('A'), item('B'), item('C')];

  it('rejects an index claimed by two different groups', () => {
    const groups = [
      { type: 'paragraph', itemIndices: [0, 1] },
      { type: 'paragraph', itemIndices: [1, 2] },
    ];
    expect(reconstructBlocks(items, groups)).toBeNull();
  });

  it('rejects a duplicate index within the same group', () => {
    const groups = [{ type: 'paragraph', itemIndices: [0, 0, 1] }];
    expect(reconstructBlocks(items, groups)).toBeNull();
  });

  it('rejects an out-of-range index', () => {
    const groups = [{ type: 'paragraph', itemIndices: [0, 99] }];
    expect(reconstructBlocks(items, groups)).toBeNull();
  });

  it('rejects a non-integer index', () => {
    const groups = [{ type: 'paragraph', itemIndices: [0.5] }];
    expect(reconstructBlocks(items, groups)).toBeNull();
  });

  it('rejects an invalid type value', () => {
    const groups = [{ type: 'section', itemIndices: [0] }];
    expect(reconstructBlocks(items, groups)).toBeNull();
  });

  it('rejects a group with no itemIndices', () => {
    const groups = [{ type: 'paragraph', itemIndices: [] }];
    expect(reconstructBlocks(items, groups)).toBeNull();
  });

  it('rejects a non-array groups value', () => {
    expect(reconstructBlocks(items, { not: 'an array' })).toBeNull();
  });

  it('rejects an empty groups array', () => {
    expect(reconstructBlocks(items, [])).toBeNull();
  });

  it('rejects a malformed group element', () => {
    expect(reconstructBlocks(items, [null])).toBeNull();
    expect(reconstructBlocks(items, ['not an object'])).toBeNull();
  });
});
