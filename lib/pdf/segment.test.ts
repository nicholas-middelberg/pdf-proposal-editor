import { readFile } from 'node:fs/promises';
import { describe, it, expect } from 'vitest';
import { segment } from './segment';
import { extractPdfItems } from './extract';
import type { PositionedItem } from '../types';

// Synthetic items keep these assertions independent of any real PDF — one
// line per item, page 1, with a plausible bbox derived from text length.
function line(text: string, y: number, fontSize = 12, x = 60): PositionedItem {
  const width = text.length * fontSize * 0.5;
  return { text, x, y, page: 1, fontSize, bbox: [x, y, x + width, y + fontSize] };
}

describe('segment — synthetic fixtures (pure heuristics)', () => {
  it('merges wrapped body lines into one paragraph, splits on a bigger gap', () => {
    const items = [
      line('SECTION 1: SCOPE OF WORK', 100),
      line('This is the first line of a paragraph that', 85),
      line('wraps onto a second line normally.', 70),
      line('This is a new paragraph entirely.', 40), // gap (30) > 1.6x typical (15) -> new block
    ];
    const blocks = segment(items);
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'paragraph']);
    expect(blocks[0].text).toBe('SECTION 1: SCOPE OF WORK');
    expect(blocks[1].text).toBe(
      'This is the first line of a paragraph that wraps onto a second line normally.',
    );
    expect(blocks[2].text).toBe('This is a new paragraph entirely.');
  });

  it('detects a heading via font-size jump even without caps or numbering', () => {
    const items = [
      line('Introduction', 200, 24), // 2x the body size below
      line('Body copy at the normal reading size for this page.', 170, 12),
      line('More body copy at the same normal size.', 155, 12),
      line('Another body line to establish the font-size mode.', 140, 12),
    ];
    const blocks = segment(items);
    expect(blocks[0].type).toBe('heading');
    expect(blocks[0].text).toBe('Introduction');
  });

  it('does not misfire on a numbered street address (no literal period after the digits)', () => {
    const items = [line('305 S Elm Street', 100), line('Dixon, MO 65459', 85)];
    const blocks = segment(items);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
  });

  it('does detect a real numbered heading ("1. Introduction")', () => {
    const items = [line('1. Introduction', 100), line('Body text right after the heading.', 85)];
    const blocks = segment(items);
    expect(blocks[0].type).toBe('heading');
    expect(blocks[0].text).toBe('1. Introduction');
  });

  it('collapses a duplicate glyph run (shadow/bold double-draw) instead of doubling text', () => {
    const a = line('Statement of Qualifications', 100, 24);
    const b = { ...a, x: a.x + 1 }; // near-identical position, same page+text
    const blocks = segment([a, b]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('Statement of Qualifications');
  });

  it('returns [] for no items', () => {
    expect(segment([])).toEqual([]);
  });
});

describe('segment — against the easy fixture (D-009)', () => {
  it('produces sensible headings and merged paragraphs', async () => {
    const buf = await readFile('fixtures/easy.pdf');
    const { items } = await extractPdfItems(new Uint8Array(buf));
    const blocks = segment(items);

    expect(blocks.length).toBeGreaterThan(0);

    const headingTexts = blocks.filter((b) => b.type === 'heading').map((b) => b.text);
    for (const expected of [
      'OUR FIRM',
      'SERVICES',
      'RELEVANT EXPERIENCE',
      'YOUR TEAM',
      'OUR APPROACH',
      'CORPORATE REGISTRATION',
    ]) {
      expect(headingTexts).toContain(expected);
    }

    const paragraphTexts = blocks.filter((b) => b.type === 'paragraph').map((b) => b.text);
    expect(
      paragraphTexts.some((t) =>
        t.includes(
          'MECO Engineering Company, Inc. (MECO) is pleased to present qualifications to the City of Dixon, MO for professional engineering services.',
        ),
      ),
    ).toBe(true);

    // ids are unique (D-015) and pages are non-decreasing (document order).
    expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i].page).toBeGreaterThanOrEqual(blocks[i - 1].page);
    }
  });
});
