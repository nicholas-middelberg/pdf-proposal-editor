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

function isDocStateShape(value: unknown): value is DocState {
  if (!value || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  return (
    Array.isArray(d.blocks) &&
    Array.isArray(d.history) &&
    typeof d.head === 'number' &&
    Array.isArray(d.rejections)
  );
}

function isPersistedDoc(value: unknown): value is PersistedDoc {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.version === SCHEMA_VERSION && isDocStateShape(v.doc) && Array.isArray(v.items);
}

/**
 * Wrapped write (SPECS silent-failure #4): never throws. On quota or any
 * other storage failure, returns a warning instead of losing work silently
 * or crashing — the in-memory document is unaffected either way; only
 * refresh-durability is at risk.
 */
export function saveDoc(doc: DocState, items: PositionedItem[]): SaveResult {
  const payload: PersistedDoc = { version: SCHEMA_VERSION, doc, items };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return { ok: true };
  } catch {
    return {
      ok: false,
      error:
        'Your changes are not being saved in this browser (storage limit reached). Keep working — just avoid refreshing until this clears.',
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
