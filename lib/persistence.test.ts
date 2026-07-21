import { readFile } from 'node:fs/promises';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { saveDoc, loadDoc, clearDoc } from './persistence';
import { initDoc, applyEdit } from './store';
import { extractPdfItems } from './pdf/extract';
import { segment } from './pdf/segment';
import type { Block, PositionedItem } from './types';

// Vitest runs in Node (D-009) — there's no real browser localStorage here,
// and depending on Node's own experimental Storage implementation would be
// fragile. Stub a minimal, spec-shaped in-memory Storage instead.
class FakeStorage {
  private data = new Map<string, string>();
  private quota: number | null = null;

  setQuota(bytes: number | null) {
    this.quota = bytes;
  }

  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    if (this.quota !== null && value.length > this.quota) {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    }
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

let fakeStorage: FakeStorage;

beforeEach(() => {
  fakeStorage = new FakeStorage();
  vi.stubGlobal('localStorage', fakeStorage);
});

function blocks(): Block[] {
  return [
    { id: 'a', type: 'paragraph', text: 'Alpha original.', page: 1, bbox: [0, 0, 0, 0] },
    { id: 'b', type: 'paragraph', text: 'Bravo original.', page: 1, bbox: [0, 0, 0, 0] },
  ];
}

describe('saveDoc / loadDoc round-trip', () => {
  it('persists and restores a document exactly', () => {
    let doc = initDoc(blocks());
    doc = applyEdit(doc, 'a', 'Alpha v1.', 'tighten', 1);
    const items: PositionedItem[] = [{ text: 'Alpha original.', x: 0, y: 0, page: 1, bbox: [0, 0, 0, 0] }];

    const result = saveDoc(doc, items);
    expect(result.ok).toBe(true);

    const restored = loadDoc();
    expect(restored).not.toBeNull();
    expect(restored!.doc).toEqual(doc);
    expect(restored!.items).toEqual(items);
  });
});

describe('loadDoc — absent or invalid data never throws, just returns null', () => {
  it('returns null when nothing has been saved', () => {
    expect(loadDoc()).toBeNull();
  });

  it('returns null for unparseable JSON', () => {
    localStorage.setItem('pdf-proposal-editor:v1', 'not json{{{');
    expect(loadDoc()).toBeNull();
  });

  it('returns null for a wrong-shaped payload', () => {
    localStorage.setItem('pdf-proposal-editor:v1', JSON.stringify({ foo: 'bar' }));
    expect(loadDoc()).toBeNull();
  });

  it('returns null for a mismatched schema version', () => {
    const doc = initDoc(blocks());
    localStorage.setItem(
      'pdf-proposal-editor:v1',
      JSON.stringify({ version: 999, doc, items: [] }),
    );
    expect(loadDoc()).toBeNull();
  });

  it('returns null if localStorage.getItem itself throws (e.g. disabled storage)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage disabled');
      },
    });
    expect(loadDoc()).toBeNull();
  });
});

describe('loadDoc — deep validation catches malformed-but-parseable payloads', () => {
  // A shallow shape check (Array.isArray/typeof only) would admit these and
  // let them crash later inside lib/store.ts / DocumentView on render — a
  // poisoned payload that then re-crashes on every subsequent refresh.
  const base = () => ({ version: 1, doc: initDoc(blocks()), items: [] as unknown[] });

  it('rejects a block missing required fields', () => {
    const payload = base();
    (payload.doc.blocks as unknown[])[0] = { id: 'a' }; // missing type/text/page/bbox
    localStorage.setItem('pdf-proposal-editor:v1', JSON.stringify(payload));
    expect(loadDoc()).toBeNull();
  });

  it('rejects a non-object block element', () => {
    const payload = base();
    (payload.doc.blocks as unknown[])[0] = null;
    localStorage.setItem('pdf-proposal-editor:v1', JSON.stringify(payload));
    expect(loadDoc()).toBeNull();
  });

  it('rejects head out of bounds (would index history[head] unchecked)', () => {
    const payload = base();
    payload.doc.head = 5; // history is empty
    localStorage.setItem('pdf-proposal-editor:v1', JSON.stringify(payload));
    expect(loadDoc()).toBeNull();
  });

  it('rejects a malformed history entry', () => {
    const payload = base();
    payload.doc.history = [{ blockId: 'a' }] as never; // missing from/to/instruction/at
    payload.doc.head = 0;
    localStorage.setItem('pdf-proposal-editor:v1', JSON.stringify(payload));
    expect(loadDoc()).toBeNull();
  });

  it('rejects a malformed positioned item', () => {
    const payload = base();
    payload.items = [{ text: 'x' }]; // missing x/y/page/bbox
    localStorage.setItem('pdf-proposal-editor:v1', JSON.stringify(payload));
    expect(loadDoc()).toBeNull();
  });

  it('accepts a fully well-formed payload', () => {
    const payload = base();
    localStorage.setItem('pdf-proposal-editor:v1', JSON.stringify(payload));
    expect(loadDoc()).not.toBeNull();
  });
});

describe('saveDoc — quota failure surfaces a warning, never throws (silent-failure risk #4)', () => {
  it('returns ok:false with a message instead of throwing', () => {
    fakeStorage.setQuota(10); // tiny, guaranteed to be exceeded
    const doc = initDoc(blocks());
    const result = saveDoc(doc, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it('a prior successful save is left untouched by a later failed one', () => {
    const doc = initDoc(blocks());
    expect(saveDoc(doc, []).ok).toBe(true);
    fakeStorage.setQuota(1);
    saveDoc(initDoc([]), []); // fails, should not corrupt what's already stored
    expect(loadDoc()!.doc).toEqual(doc);
  });

  it('reports a quota-specific message for a real QuotaExceededError', () => {
    fakeStorage.setQuota(10);
    const result = saveDoc(initDoc(blocks()), []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/storage limit reached/i);
  });

  it('reports a generic (non-quota) message for a different storage failure', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('storage disabled'); // not a DOMException/QuotaExceededError
      },
    });
    const result = saveDoc(initDoc(blocks()), []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toMatch(/storage limit reached/i);
  });
});

describe('clearDoc', () => {
  it('removes the persisted document', () => {
    saveDoc(initDoc(blocks()), []);
    expect(loadDoc()).not.toBeNull();
    clearDoc();
    expect(loadDoc()).toBeNull();
  });

  it('never throws even if storage access fails', () => {
    vi.stubGlobal('localStorage', {
      removeItem: () => {
        throw new Error('storage disabled');
      },
    });
    expect(() => clearDoc()).not.toThrow();
  });
});

describe('persisted size against a real fixture (D-006: verify, do not assume)', () => {
  it('hard.pdf (the larger fixture) stays comfortably under localStorage quota', async () => {
    const buf = await readFile('fixtures/hard.pdf');
    const { items } = await extractPdfItems(new Uint8Array(buf));
    const docBlocks = segment(items);
    const doc = initDoc(docBlocks);

    const payload = JSON.stringify({ version: 1, doc, items });
    const sizeMB = payload.length / (1024 * 1024);
    console.log(`hard.pdf persisted payload size: ${sizeMB.toFixed(2)} MB`);

    // Real per-origin quotas are ~5-10MB; stay well under even the low end.
    expect(payload.length).toBeLessThan(2 * 1024 * 1024);
  });
});
