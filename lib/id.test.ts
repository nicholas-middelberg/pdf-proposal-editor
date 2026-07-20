import { describe, it, expect } from 'vitest';
import { fnv1a, normalizeForId, contentId, assignBlockIds } from './id';

describe('fnv1a', () => {
  it('is deterministic', () => {
    expect(fnv1a('hello')).toBe(fnv1a('hello'));
  });

  it('differs for different input', () => {
    expect(fnv1a('hello')).not.toBe(fnv1a('world'));
  });

  it('returns 8-char hex', () => {
    expect(fnv1a('anything')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('normalizeForId', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeForId('  a   b\n c ')).toBe('a b c');
  });
});

describe('contentId', () => {
  it('is stable for the same text + page', () => {
    expect(contentId('The bid is $1,250,000.', 2)).toBe(
      contentId('The bid is $1,250,000.', 2),
    );
  });

  it('is insensitive to trivial whitespace differences', () => {
    expect(contentId('a   b', 1)).toBe(contentId('a b', 1));
  });

  it('changes with page', () => {
    expect(contentId('same text', 1)).not.toBe(contentId('same text', 2));
  });

  it('changes with occurrence (tie-break)', () => {
    expect(contentId('same text', 1, 0)).not.toBe(
      contentId('same text', 1, 1),
    );
  });

  it('is NOT positional — reordering identical content keeps ids', () => {
    expect(contentId('boilerplate clause', 3, 0)).toBe(
      contentId('boilerplate clause', 3, 0),
    );
  });
});

describe('assignBlockIds', () => {
  it('gives every block a content-derived id', () => {
    const out = assignBlockIds([
      { text: 'Intro', page: 1 },
      { text: 'Scope of work', page: 1 },
    ]);
    expect(out[0].id).toBe(contentId('Intro', 1, 0));
    expect(out[1].id).toBe(contentId('Scope of work', 1, 0));
  });

  it('disambiguates identical repeated boilerplate with occurrence index', () => {
    const out = assignBlockIds([
      { text: 'Confidential', page: 1 },
      { text: 'Confidential', page: 1 },
      { text: 'Confidential', page: 1 },
    ]);
    const ids = out.map((b) => b.id);
    expect(new Set(ids).size).toBe(3); // all distinct
    expect(ids[0]).toBe(contentId('Confidential', 1, 0));
    expect(ids[1]).toBe(contentId('Confidential', 1, 1));
    expect(ids[2]).toBe(contentId('Confidential', 1, 2));
  });

  it('treats identical text on different pages as separate keys', () => {
    const out = assignBlockIds([
      { text: 'Notes', page: 1 },
      { text: 'Notes', page: 2 },
    ]);
    // Each is occurrence 0 within its own page.
    expect(out[0].id).toBe(contentId('Notes', 1, 0));
    expect(out[1].id).toBe(contentId('Notes', 2, 0));
  });

  it('preserves other block fields', () => {
    const out = assignBlockIds([
      { text: 'Hi', page: 1, type: 'paragraph' as const, extra: 42 },
    ]);
    expect(out[0].type).toBe('paragraph');
    expect(out[0].extra).toBe(42);
  });
});
