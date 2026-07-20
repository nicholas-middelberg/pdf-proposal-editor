import { describe, it, expect } from 'vitest';
import { diffWords } from './diff';

function reconstruct(tokens: ReturnType<typeof diffWords>, side: 'a' | 'b'): string {
  return tokens
    .filter((t) => (side === 'a' ? t.kind !== 'added' : t.kind !== 'removed'))
    .map((t) => t.text)
    .join('');
}

describe('diffWords', () => {
  it('marks everything same for identical text', () => {
    const tokens = diffWords('The bid is $1,250,000.', 'The bid is $1,250,000.');
    expect(tokens.every((t) => t.kind === 'same')).toBe(true);
  });

  it('marks a single changed word as removed+added, not the whole sentence', () => {
    const tokens = diffWords('The bid is due January 15, 2026.', 'The bid is due February 15, 2026.');
    expect(tokens.some((t) => t.kind === 'removed' && t.text === 'January')).toBe(true);
    expect(tokens.some((t) => t.kind === 'added' && t.text === 'February')).toBe(true);
    // everything else stayed "same"
    const changed = tokens.filter((t) => t.kind !== 'same');
    expect(changed.map((t) => t.text)).toEqual(['January', 'February']);
  });

  it('handles a pure insertion', () => {
    const tokens = diffWords('The bid is due.', 'The final bid is due.');
    expect(tokens.some((t) => t.kind === 'added' && t.text === 'final')).toBe(true);
  });

  it('handles a pure deletion', () => {
    const tokens = diffWords('The final bid is due.', 'The bid is due.');
    expect(tokens.some((t) => t.kind === 'removed' && t.text === 'final')).toBe(true);
  });

  it('reconstructs both original and proposed text exactly from the tokens', () => {
    const a = 'Tighten this paragraph please.';
    const b = 'Please tighten this paragraph.';
    const tokens = diffWords(a, b);
    expect(reconstruct(tokens, 'a')).toBe(a);
    expect(reconstruct(tokens, 'b')).toBe(b);
  });

  it('handles empty strings', () => {
    expect(diffWords('', '')).toEqual([]);
    expect(diffWords('hello', '').every((t) => t.kind === 'removed')).toBe(true);
    expect(diffWords('', 'hello').every((t) => t.kind === 'added')).toBe(true);
  });
});
