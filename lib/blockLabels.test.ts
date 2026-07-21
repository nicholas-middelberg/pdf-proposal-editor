import { describe, it, expect } from 'vitest';
import { labelBlocks } from './blockLabels';
import type { Block } from './types';

function block(id: string, type: Block['type'], text: string): Block {
  return { id, type, text, page: 1, bbox: [0, 0, 0, 0] };
}

describe('labelBlocks', () => {
  it('gives a paragraph before any heading a null heading and index 1', () => {
    const blocks = [block('a', 'paragraph', 'Intro line.')];
    const labels = labelBlocks(blocks);
    expect(labels.get('a')).toEqual({ heading: null, index: 1 });
  });

  it('assigns the nearest preceding heading to each paragraph', () => {
    const blocks = [
      block('h1', 'heading', 'Our Firm'),
      block('a', 'paragraph', 'First.'),
      block('h2', 'heading', 'Services'),
      block('b', 'paragraph', 'Second.'),
    ];
    const labels = labelBlocks(blocks);
    expect(labels.get('a')).toEqual({ heading: 'Our Firm', index: 1 });
    expect(labels.get('b')).toEqual({ heading: 'Services', index: 2 });
  });

  it('shares one heading across multiple paragraphs under it', () => {
    const blocks = [
      block('h1', 'heading', 'Our Firm'),
      block('a', 'paragraph', 'First.'),
      block('b', 'paragraph', 'Second.'),
    ];
    const labels = labelBlocks(blocks);
    expect(labels.get('a')!.heading).toBe('Our Firm');
    expect(labels.get('b')!.heading).toBe('Our Firm');
    expect(labels.get('a')!.index).toBe(1);
    expect(labels.get('b')!.index).toBe(2);
  });

  it('updates heading again on consecutive headings with no paragraph between', () => {
    const blocks = [
      block('h1', 'heading', 'Old Title'),
      block('h2', 'heading', 'Real Title'),
      block('a', 'paragraph', 'Body.'),
    ];
    const labels = labelBlocks(blocks);
    expect(labels.get('a')!.heading).toBe('Real Title');
  });

  it('index counts only paragraphs, not headings', () => {
    const blocks = [
      block('h1', 'heading', 'H'),
      block('a', 'paragraph', 'A'),
      block('h2', 'heading', 'H2'),
      block('b', 'paragraph', 'B'),
      block('c', 'paragraph', 'C'),
    ];
    const labels = labelBlocks(blocks);
    expect(labels.get('a')!.index).toBe(1);
    expect(labels.get('b')!.index).toBe(2);
    expect(labels.get('c')!.index).toBe(3);
  });
});
