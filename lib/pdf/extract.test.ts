import { readFile } from 'node:fs/promises';
import { describe, it, expect } from 'vitest';
import { extractPdfItems, hasTextLayer, looksLikePdf } from './extract';
import type { PositionedItem } from '../types';

describe('looksLikePdf', () => {
  it('accepts real PDF magic bytes', () => {
    expect(looksLikePdf(new TextEncoder().encode('%PDF-1.7\n...'))).toBe(true);
  });

  it('rejects non-PDF content', () => {
    expect(looksLikePdf(new TextEncoder().encode('not a pdf at all'))).toBe(false);
    expect(looksLikePdf(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false); // PNG magic
  });

  it('rejects buffers shorter than the magic number', () => {
    expect(looksLikePdf(new Uint8Array([0x25, 0x50]))).toBe(false);
  });
});

describe('hasTextLayer (D-008 guard)', () => {
  function item(text: string): PositionedItem {
    return { text, x: 0, y: 0, page: 1, bbox: [0, 0, 0, 0] };
  }

  it('is false for no items at all (scanned PDF, zero extracted text)', () => {
    expect(hasTextLayer([])).toBe(false);
  });

  it('is false when extracted text is near-zero (stray whitespace/artifacts)', () => {
    expect(hasTextLayer([item('  '), item('.')])).toBe(false);
  });

  it('is true once there is a real amount of extracted text', () => {
    const items = Array.from({ length: 10 }, () => item('some real sentence content'));
    expect(hasTextLayer(items)).toBe(true);
  });
});

describe('extractPdfItems (against the easy fixture)', () => {
  it('extracts positioned items across all pages with a real text layer', async () => {
    const buf = await readFile('fixtures/easy.pdf');
    const { items, totalPages } = await extractPdfItems(new Uint8Array(buf));
    expect(totalPages).toBe(8);
    expect(items.length).toBeGreaterThan(0);
    expect(hasTextLayer(items)).toBe(true);
    // Every item carries the positional data the segmenter and re-detect need.
    for (const it of items) {
      expect(it.page).toBeGreaterThanOrEqual(1);
      expect(it.page).toBeLessThanOrEqual(totalPages);
      expect(typeof it.x).toBe('number');
      expect(typeof it.y).toBe('number');
    }
  });
});
