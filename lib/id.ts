// Content-derived, stable Block ids (D-015).
//
// "Stable" means NOT positional: array indices break the moment a re-detect
// merges or splits paragraphs, silently re-pointing history at the wrong
// block. We derive the id from content (hash of normalized text + page) and
// break ties with an occurrence index so repeated boilerplate (identical text
// on the same page) never collides onto one id.

/** FNV-1a 32-bit hash → 8-char hex. Deterministic in browser and Node. */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // 32-bit FNV prime multiply via Math.imul to stay in int range.
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Normalize text for hashing so trivial whitespace differences don't produce a
 * different id: trim ends, collapse internal runs of whitespace to one space.
 */
export function normalizeForId(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * Content-derived id for a single block. `occurrence` disambiguates identical
 * text on the same page (default 0). Format: `<hash>-p<page>-o<occurrence>`.
 */
export function contentId(text: string, page: number, occurrence = 0): string {
  const hash = fnv1a(`${page}:${normalizeForId(text)}`);
  return `${hash}-p${page}-o${occurrence}`;
}

/**
 * Assign content-derived ids across a list of raw blocks, computing the
 * occurrence index per (page, normalized-text) key so duplicates get distinct
 * ids. This is the ONLY correct way to build ids for a document — "stable id"
 * is not "don't regenerate ids", it's "derive from content + break ties"
 * (D-015).
 */
export function assignBlockIds<T extends { text: string; page: number }>(
  raw: readonly T[],
): (T & { id: string })[] {
  const seen = new Map<string, number>();
  return raw.map((b) => {
    const key = `${b.page}:${normalizeForId(b.text)}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return { ...b, id: contentId(b.text, b.page, occurrence) };
  });
}
