// Export the current document state as markdown (D-001, Task 9). Pure and
// unit-tested like the other high-stakes lib/ modules. Layout fidelity
// (tables, letterheads, pricing schedules) is a deliberate non-goal — headings
// become "## " lines and paragraphs become plain text, in document order.

import type { Block } from './types';

export function toMarkdown(blocks: Block[]): string {
  return blocks
    .map((b) => (b.type === 'heading' ? `## ${b.text}` : b.text))
    .join('\n\n');
}
