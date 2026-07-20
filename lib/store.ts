// Edit-state machine (D-015). Built FIRST and unit-tested because it is the
// least-tested (D-009) and highest bug-density part of the app.
//
// POINTER-BASED LINEAR HISTORY — array + HEAD, NOT a pop/discard stack:
//   - `history` is an append-only array of accepted edits (drives undo/redo).
//   - `head` is the index of the last APPLIED entry; -1 means nothing applied.
//   - Undo moves `head` left (the entry stays in the array, re-applicable).
//   - Redo moves `head` right.
//   - A new edit made while `head` is not at the end truncates the redo tail,
//     then appends (Word's behavior — a new action clears the redo path).
//   - Current text of a block = the most recent applied entry for that block,
//     or the original parsed text if none. (Derives "apply entries [0..head]".)
//
// v1 ships UNDO only in the UI; `redo` exists in the model so the redo button
// and a scrubbable timeline are later pure-UI additions over `head` movement,
// with no change to this data structure.

import type { Block, HistoryEntry } from './types';

/** A recorded reject. Audit-only: does NOT change document text or `head`. */
export type RejectionEntry = {
  blockId: string;
  original: string;
  proposed: string;
  instruction: string;
  at: number;
};

export type DocState = {
  /** Original parsed blocks — the per-id baseline. Never mutated by edits. */
  blocks: Block[];
  /** Linear log of accepted edits. Append-only; entries are never deleted. */
  history: HistoryEntry[];
  /** Index of the last applied entry. -1 = nothing applied. */
  head: number;
  /** Recorded rejections (audit trail). */
  rejections: RejectionEntry[];
};

export function initDoc(blocks: Block[]): DocState {
  return { blocks, history: [], head: -1, rejections: [] };
}

/** Replace the parsed blocks (e.g. after a pre-edit re-detect). Resets state. */
export function setBlocks(_state: DocState, blocks: Block[]): DocState {
  return initDoc(blocks);
}

function originalText(state: DocState, blockId: string): string {
  return state.blocks.find((b) => b.id === blockId)?.text ?? '';
}

/**
 * The current text of a block: the most recent APPLIED edit (index <= head),
 * else the original parsed text. This is also the validation baseline — the
 * "immediate prior text", not the pristine parse (D-015).
 */
export function currentText(state: DocState, blockId: string): string {
  for (let i = state.head; i >= 0; i--) {
    if (state.history[i].blockId === blockId) return state.history[i].to;
  }
  return originalText(state, blockId);
}

/** Alias that names the intent at the validator call site. */
export const baselineText = currentText;

/** The blocks with current (composed) text applied, ids preserved. */
export function currentBlocks(state: DocState): Block[] {
  return state.blocks.map((b) => ({ ...b, text: currentText(state, b.id) }));
}

/** Applied history slice (for the history panel / undo affordance). */
export function appliedHistory(state: DocState): HistoryEntry[] {
  return state.history.slice(0, state.head + 1);
}

export function canUndo(state: DocState): boolean {
  return state.head >= 0;
}

export function canRedo(state: DocState): boolean {
  return state.head < state.history.length - 1;
}

/**
 * Apply an accepted edit. `from` is captured as the immediate prior text
 * (the baseline). If `head` is not at the end, the redo tail is discarded
 * first, then the new entry is appended and becomes `head`.
 */
export function applyEdit(
  state: DocState,
  blockId: string,
  to: string,
  instruction: string,
  at: number = Date.now(),
): DocState {
  const from = currentText(state, blockId);
  const kept = state.history.slice(0, state.head + 1); // drop redo tail
  const history = [...kept, { blockId, from, to, instruction, at }];
  return { ...state, history, head: history.length - 1 };
}

/** Move `head` left. Entry is NOT deleted — it stays re-applicable via redo. */
export function undo(state: DocState): DocState {
  if (!canUndo(state)) return state;
  return { ...state, head: state.head - 1 };
}

/** Move `head` right, re-applying the next entry. */
export function redo(state: DocState): DocState {
  if (!canRedo(state)) return state;
  return { ...state, head: state.head + 1 };
}

/** Record a rejected proposal. Audit-only — text and `head` are unchanged. */
export function recordRejection(
  state: DocState,
  blockId: string,
  proposed: string,
  instruction: string,
  at: number = Date.now(),
): DocState {
  const original = currentText(state, blockId);
  return {
    ...state,
    rejections: [
      ...state.rejections,
      { blockId, original, proposed, instruction, at },
    ],
  };
}
