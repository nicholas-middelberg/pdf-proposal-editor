// Runs extract + segment off the main thread (D-011). The PDF's bytes never
// leave the browser — no /api/parse exists. Instantiated client-side (Task 6)
// as `new Worker(new URL('./parse.worker.ts', import.meta.url))`.

import { extractPdfItems, hasTextLayer, looksLikePdf } from './extract';
import { segment } from './segment';
import type { Block, PositionedItem } from '../types';

export type ParseWorkerRequest = {
  type: 'parse';
  /** Raw file bytes, transferred (not copied) from the main thread. */
  data: ArrayBuffer;
};

export type ParseWorkerResponse =
  | { type: 'success'; blocks: Block[]; items: PositionedItem[]; totalPages: number }
  | { type: 'error'; reason: 'not-a-pdf' | 'no-text-layer' | 'parse-failed'; message: string };

async function handleParse(data: ArrayBuffer): Promise<ParseWorkerResponse> {
  const bytes = new Uint8Array(data);

  if (!looksLikePdf(bytes)) {
    return { type: 'error', reason: 'not-a-pdf', message: 'That file is not a PDF.' };
  }

  let items: PositionedItem[];
  let totalPages: number;
  try {
    ({ items, totalPages } = await extractPdfItems(bytes));
  } catch {
    return {
      type: 'error',
      reason: 'parse-failed',
      message: 'Could not read this PDF. It may be corrupted or password-protected.',
    };
  }

  if (!hasTextLayer(items)) {
    return {
      type: 'error',
      reason: 'no-text-layer',
      message: 'This PDF has no extractable text (likely a scan). OCR is not supported.',
    };
  }

  const blocks = segment(items);
  return { type: 'success', blocks, items, totalPages };
}

self.onmessage = async (event: MessageEvent<ParseWorkerRequest>) => {
  if (event.data.type !== 'parse') return;
  const response = await handleParse(event.data.data);
  (self as unknown as Worker).postMessage(response);
};
