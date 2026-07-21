import { describe, it, expect } from 'vitest';
import { toMarkdown } from './export';
import type { Block } from './types';

function block(partial: Partial<Block>): Block {
  return { id: 'x', type: 'paragraph', text: '', page: 1, bbox: [0, 0, 0, 0], ...partial };
}

describe('toMarkdown', () => {
  it('renders a heading as an ATX-style markdown heading', () => {
    const blocks = [block({ type: 'heading', text: 'Scope of Work' })];
    expect(toMarkdown(blocks)).toBe('## Scope of Work');
  });

  it('renders a paragraph as plain text', () => {
    const blocks = [block({ type: 'paragraph', text: 'We will complete the work by June.' })];
    expect(toMarkdown(blocks)).toBe('We will complete the work by June.');
  });

  it('separates blocks with a blank line, preserving document order', () => {
    const blocks = [
      block({ type: 'heading', text: 'Section One' }),
      block({ type: 'paragraph', text: 'First paragraph.' }),
      block({ type: 'paragraph', text: 'Second paragraph.' }),
      block({ type: 'heading', text: 'Section Two' }),
    ];
    expect(toMarkdown(blocks)).toBe(
      '## Section One\n\nFirst paragraph.\n\nSecond paragraph.\n\n## Section Two',
    );
  });

  it('reflects edited text, not original text, when passed already-composed blocks', () => {
    // Task 9 scope: caller passes currentBlocks(doc) (all accepted edits
    // composed) — this module just formats whatever text it's given.
    const blocks = [block({ type: 'paragraph', text: 'Edited version.' })];
    expect(toMarkdown(blocks)).toBe('Edited version.');
  });

  it('returns an empty string for no blocks', () => {
    expect(toMarkdown([])).toBe('');
  });
});
