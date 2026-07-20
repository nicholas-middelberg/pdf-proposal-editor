// Edit-call length cap (Flag B, resolved in DECISIONS.md). NOT a model-
// performance limit — it's a mis-merge tripwire. There is no quality cliff at
// paragraph scale; the cap exists to catch parser failures (a whole page or
// interleaved columns collapsed into one "paragraph"), bound the D-013
// validator's per-block surface, and bound outlier request cost.
//
// Derived from data, not guessed: segmenting fixtures/easy.pdf (Task 4) found
// a longest genuine paragraph of 1188 characters. The cap is ~4x that —
// anything above it is definitionally a mis-merge, not a long-but-real
// paragraph.
export const MAX_PARAGRAPH_CHARS = 4800;

/**
 * Exceeding the cap or being empty both BLOCK the edit call (never truncate —
 * truncation silently drops trailing facts, the exact failure class this
 * product exists to prevent).
 */
export function paragraphLengthError(text: string): string | null {
  if (text.trim().length === 0) return 'This paragraph is empty — nothing to edit.';
  if (text.length > MAX_PARAGRAPH_CHARS) {
    return `This paragraph is too long to edit (${text.length} characters, limit ${MAX_PARAGRAPH_CHARS}). This usually means the parser merged more than one real paragraph — try re-detecting sections.`;
  }
  return null;
}
