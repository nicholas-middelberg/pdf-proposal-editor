import { describe, it, expect } from 'vitest';
import type { Block } from './types';
import {
  initDoc,
  applyEdit,
  undo,
  redo,
  canUndo,
  canRedo,
  currentText,
  currentBlocks,
  appliedHistory,
  recordRejection,
} from './store';

// Synthetic blocks so the state machine is testable without the PDF parser.
function blocks(): Block[] {
  return [
    { id: 'a', type: 'paragraph', text: 'Alpha original.', page: 1, bbox: [0, 0, 0, 0] },
    { id: 'b', type: 'paragraph', text: 'Bravo original.', page: 1, bbox: [0, 0, 0, 0] },
  ];
}

const text = (s: ReturnType<typeof initDoc>, id: string) => currentText(s, id);

describe('initDoc', () => {
  it('starts with empty history and head at -1', () => {
    const s = initDoc(blocks());
    expect(s.history).toEqual([]);
    expect(s.head).toBe(-1);
    expect(canUndo(s)).toBe(false);
    expect(canRedo(s)).toBe(false);
    expect(text(s, 'a')).toBe('Alpha original.');
  });
});

describe('applyEdit', () => {
  it('applies an edit and advances head', () => {
    let s = initDoc(blocks());
    s = applyEdit(s, 'a', 'Alpha v1.', 'tighten', 1);
    expect(s.head).toBe(0);
    expect(text(s, 'a')).toBe('Alpha v1.');
    expect(text(s, 'b')).toBe('Bravo original.'); // untouched
  });

  it('captures `from` as the immediate prior text (baseline, D-015)', () => {
    let s = initDoc(blocks());
    s = applyEdit(s, 'a', 'Alpha v1.', 'i1', 1);
    s = applyEdit(s, 'a', 'Alpha v2.', 'i2', 2);
    expect(s.history[1].from).toBe('Alpha v1.'); // not the pristine parse
    expect(s.history[1].to).toBe('Alpha v2.');
  });

  it('composes a second edit on top of the first', () => {
    let s = initDoc(blocks());
    s = applyEdit(s, 'a', 'Alpha v1.', 'i1', 1);
    s = applyEdit(s, 'a', 'Alpha v2.', 'i2', 2);
    expect(text(s, 'a')).toBe('Alpha v2.');
    expect(s.head).toBe(1);
  });
});

describe('undo (pointer moves, no deletion)', () => {
  it('decrements head WITHOUT deleting the entry', () => {
    let s = initDoc(blocks());
    s = applyEdit(s, 'a', 'Alpha v1.', 'i1', 1);
    const lenBefore = s.history.length;
    s = undo(s);
    expect(s.head).toBe(-1);
    expect(s.history.length).toBe(lenBefore); // entry preserved
    expect(text(s, 'a')).toBe('Alpha original.');
  });

  it('reverts the LAST accepted edit globally, across paragraphs', () => {
    let s = initDoc(blocks());
    s = applyEdit(s, 'a', 'Alpha v1.', 'i1', 1);
    s = applyEdit(s, 'b', 'Bravo v1.', 'i2', 2);
    s = undo(s); // undoes the b edit (most recent), not a
    expect(text(s, 'b')).toBe('Bravo original.');
    expect(text(s, 'a')).toBe('Alpha v1.');
  });

  it('is a no-op past the start', () => {
    let s = initDoc(blocks());
    s = undo(s);
    expect(s.head).toBe(-1);
    expect(canUndo(s)).toBe(false);
  });

  it('text = apply entries [0..head] after multiple undos', () => {
    let s = initDoc(blocks());
    s = applyEdit(s, 'a', 'Alpha v1.', 'i1', 1);
    s = applyEdit(s, 'a', 'Alpha v2.', 'i2', 2);
    s = undo(s);
    expect(text(s, 'a')).toBe('Alpha v1.'); // head=0 → first entry only
    s = undo(s);
    expect(text(s, 'a')).toBe('Alpha original.'); // head=-1 → none
  });
});

describe('redo', () => {
  it('re-applies an undone entry', () => {
    let s = initDoc(blocks());
    s = applyEdit(s, 'a', 'Alpha v1.', 'i1', 1);
    s = undo(s);
    expect(canRedo(s)).toBe(true);
    s = redo(s);
    expect(s.head).toBe(0);
    expect(text(s, 'a')).toBe('Alpha v1.');
  });

  it('is a no-op past the end', () => {
    let s = initDoc(blocks());
    s = applyEdit(s, 'a', 'Alpha v1.', 'i1', 1);
    s = redo(s);
    expect(s.head).toBe(0);
    expect(canRedo(s)).toBe(false);
  });
});

describe('new edit after undo truncates the redo tail (Word behavior)', () => {
  it('discards everything after head, then appends', () => {
    let s = initDoc(blocks());
    s = applyEdit(s, 'a', 'Alpha v1.', 'i1', 1);
    s = applyEdit(s, 'a', 'Alpha v2.', 'i2', 2);
    s = undo(s); // head=0, redo tail = [v2]
    s = applyEdit(s, 'a', 'Alpha v1b.', 'i3', 3); // truncates v2, appends v1b
    expect(s.history.length).toBe(2);
    expect(s.history[1].to).toBe('Alpha v1b.');
    expect(s.head).toBe(1);
    expect(canRedo(s)).toBe(false); // the old v2 redo path is gone
    expect(text(s, 'a')).toBe('Alpha v1b.');
  });
});

describe('currentBlocks + appliedHistory', () => {
  it('currentBlocks reflects composed text and preserves ids', () => {
    let s = initDoc(blocks());
    s = applyEdit(s, 'a', 'Alpha v1.', 'i1', 1);
    const cb = currentBlocks(s);
    expect(cb.find((b) => b.id === 'a')!.text).toBe('Alpha v1.');
    expect(cb.find((b) => b.id === 'b')!.text).toBe('Bravo original.');
  });

  it('appliedHistory excludes the undone (redo-tail) entries', () => {
    let s = initDoc(blocks());
    s = applyEdit(s, 'a', 'Alpha v1.', 'i1', 1);
    s = applyEdit(s, 'a', 'Alpha v2.', 'i2', 2);
    s = undo(s);
    expect(appliedHistory(s).map((h) => h.to)).toEqual(['Alpha v1.']);
  });
});

describe('recordRejection', () => {
  it('records a rejection without changing text or head', () => {
    let s = initDoc(blocks());
    s = applyEdit(s, 'a', 'Alpha v1.', 'i1', 1);
    const headBefore = s.head;
    s = recordRejection(s, 'a', 'Alpha REJECTED.', 'make it bad', 2);
    expect(s.head).toBe(headBefore);
    expect(text(s, 'a')).toBe('Alpha v1.'); // unchanged
    expect(s.rejections).toHaveLength(1);
    expect(s.rejections[0].original).toBe('Alpha v1.'); // baseline captured
    expect(s.rejections[0].proposed).toBe('Alpha REJECTED.');
  });
});
