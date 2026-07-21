// localStorage persistence (D-006). Only parsed/structured state is stored —
// NEVER the raw PDF bytes. A file's on-disk size is dominated by fonts/images
// discarded at parse time; persisting the file itself would blow the
// ~5-10MB per-origin quota for no reason (D-006). Positioned items are
// included so "re-detect with AI" (D-003) still works after a refresh.

import type { DocState } from './store';
import type { PositionedItem } from './types';

const STORAGE_KEY = 'pdf-proposal-editor:v1';
const SCHEMA_VERSION = 1;

export type PersistedDoc = {
  version: number;
  doc: DocState;
  items: PositionedItem[];
};

export type SaveResult = { ok: true } | { ok: false; error: string };

// Deep-validated, not just top-level shape: a payload that passes only
// Array.isArray/typeof checks can still contain elements that crash
// downstream renderers (lib/store.ts's currentText indexes state.history[i]
// unchecked; DocumentView maps over blocks assuming each has an id/type/
// text). Since a bad payload lives in storage, a crash on load would
// otherwise repeat on every refresh with no way out — so this validates
// thoroughly enough that anything admitted here is safe to render.

function isBBox(value: unknown): value is [number, number, number, number] {
  return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number');
}

function isBlock(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const b = value as Record<string, unknown>;
  return (
    typeof b.id === 'string' &&
    (b.type === 'heading' || b.type === 'paragraph') &&
    typeof b.text === 'string' &&
    typeof b.page === 'number' &&
    isBBox(b.bbox)
  );
}

function isHistoryEntry(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const h = value as Record<string, unknown>;
  return (
    typeof h.blockId === 'string' &&
    typeof h.from === 'string' &&
    typeof h.to === 'string' &&
    typeof h.instruction === 'string' &&
    typeof h.at === 'number'
  );
}

function isRejectionEntry(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.blockId === 'string' &&
    typeof r.original === 'string' &&
    typeof r.proposed === 'string' &&
    typeof r.instruction === 'string' &&
    typeof r.at === 'number'
  );
}

function isPositionedItem(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const it = value as Record<string, unknown>;
  return (
    typeof it.text === 'string' &&
    typeof it.x === 'number' &&
    typeof it.y === 'number' &&
    typeof it.page === 'number' &&
    isBBox(it.bbox)
  );
}

function isDocStateShape(value: unknown): value is DocState {
  if (!value || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  if (
    !Array.isArray(d.blocks) ||
    !Array.isArray(d.history) ||
    typeof d.head !== 'number' ||
    !Array.isArray(d.rejections)
  ) {
    return false;
  }
  // head must be a valid index into history, or -1 (nothing applied) —
  // currentText walks state.history[head] downward unchecked.
  if (!Number.isInteger(d.head) || d.head < -1 || d.head >= d.history.length) return false;
  return (
    d.blocks.every(isBlock) && d.history.every(isHistoryEntry) && d.rejections.every(isRejectionEntry)
  );
}

function isPersistedDoc(value: unknown): value is PersistedDoc {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === SCHEMA_VERSION &&
    isDocStateShape(v.doc) &&
    Array.isArray(v.items) &&
    v.items.every(isPositionedItem)
  );
}

/**
 * Wrapped write (SPECS silent-failure #4): never throws. On quota or any
 * other storage failure, returns a warning instead of losing work silently
 * or crashing — the in-memory document is unaffected either way; only
 * refresh-durability is at risk.
 */
function isQuotaExceeded(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}

export function saveDoc(doc: DocState, items: PositionedItem[]): SaveResult {
  const payload: PersistedDoc = { version: SCHEMA_VERSION, doc, items };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: isQuotaExceeded(err)
        ? 'Your changes are not being saved in this browser (storage limit reached). Keep working — just avoid refreshing until this clears.'
        : 'Your changes are not being saved in this browser right now. Keep working — just avoid refreshing until this is resolved.',
    };
  }
}

/**
 * Returns null if nothing is persisted, or if what's there doesn't parse or
 * match the expected shape (e.g. an older schema version). Treated as "no
 * saved document" — never a crash.
 */
export function loadDoc(): PersistedDoc | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return isPersistedDoc(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearDoc(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort — nothing to surface if even removal fails
  }
}
