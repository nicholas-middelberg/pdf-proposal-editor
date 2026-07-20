// PDF text extraction via unpdf/pdf.js (D-004): keeps positional data
// (x, y, fontSize, bbox) from day one so the multi-column reading-order
// stretch is reachable without re-parsing. v1's segmenter (segment.ts)
// itself ignores x when grouping lines — only the captured data survives
// for that later.

import { extractTextItems, getDocumentProxy } from 'unpdf';
import type { PositionedItem } from '../types';

const PDF_MAGIC = '%PDF-';

/**
 * Magic-number check so a non-PDF upload fails fast with a clear reason,
 * before handing bytes to pdf.js (whose parse errors aren't user-presentable).
 */
export function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  let header = '';
  for (let i = 0; i < PDF_MAGIC.length; i++) header += String.fromCharCode(bytes[i]);
  return header === PDF_MAGIC;
}

export type ExtractResult = {
  items: PositionedItem[];
  totalPages: number;
};

/**
 * Runs the document through pdf.js and flattens every page's text items into
 * one positioned-item list, in per-page document order (page ascending, then
 * pdf.js's own item order within a page).
 */
export async function extractPdfItems(data: Uint8Array): Promise<ExtractResult> {
  const pdf = await getDocumentProxy(data);
  const { totalPages, items } = await extractTextItems(pdf);

  const flat: PositionedItem[] = [];
  for (let page = 0; page < items.length; page++) {
    for (const it of items[page]) {
      if (!it.str.trim()) continue; // whitespace-only / line-break marker items
      flat.push({
        text: it.str,
        x: it.x,
        y: it.y,
        page: page + 1,
        bbox: [it.x, it.y, it.x + it.width, it.y + it.height],
        fontSize: it.fontSize,
      });
    }
  }
  return { items: flat, totalPages };
}

// D-008: near-zero extracted characters across the whole doc means no text
// layer (scanned PDF) — surface a clear error rather than a blank editor
// that looks like a successful parse of an empty file.
const NO_TEXT_LAYER_CHAR_THRESHOLD = 20;

export function hasTextLayer(items: PositionedItem[]): boolean {
  const totalChars = items.reduce((sum, it) => sum + it.text.trim().length, 0);
  return totalChars >= NO_TEXT_LAYER_CHAR_THRESHOLD;
}
