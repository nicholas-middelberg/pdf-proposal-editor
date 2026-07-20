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
  | { type: 'ready' }
  | { type: 'success'; blocks: Block[]; items: PositionedItem[]; totalPages: number }
  | { type: 'error'; reason: 'not-a-pdf' | 'no-text-layer' | 'parse-failed'; message: string };

async function handleParse(data: ArrayBuffer): Promise<ParseWorkerResponse> {
  const bytes = new Uint8Array(data);

  if (!looksLikePdf(bytes)) {
    return { type: 'error', reason: 'not-a-pdf', message: 'That file is not a PDF.' };
  }

  // Extraction AND segmentation share one try/catch: a segment() throw is just
  // as fatal to the parse as an extraction failure, and both must turn into a
  // loud parse-failed error rather than an unhandled rejection inside the
  // worker (which would leave the main thread waiting forever with no
  // response — the exact silent-failure shape this app is built to avoid).
  try {
    const { items, totalPages } = await extractPdfItems(bytes);

    if (!hasTextLayer(items)) {
      return {
        type: 'error',
        reason: 'no-text-layer',
        message: 'This PDF has no extractable text (likely a scan). OCR is not supported.',
      };
    }

    const blocks = segment(items);
    return { type: 'success', blocks, items, totalPages };
  } catch {
    return {
      type: 'error',
      reason: 'parse-failed',
      message: 'Could not read this PDF. It may be corrupted or password-protected.',
    };
  }
}

const worker = self as unknown as Worker;

worker.onmessage = async (event: MessageEvent<ParseWorkerRequest>) => {
  if (event.data?.type !== 'parse') return;
  let response: ParseWorkerResponse;
  try {
    response = await handleParse(event.data.data);
  } catch {
    // Belt-and-suspenders: handleParse should never reject, but if it somehow
    // does, still answer rather than leaving the main thread waiting forever.
    response = {
      type: 'error',
      reason: 'parse-failed',
      message: 'Could not read this PDF. It may be corrupted or password-protected.',
    };
  }
  worker.postMessage(response);
};

// Sent once onmessage is attached, so the main thread has a real signal to
// wait on before posting the parse request — postMessage sent immediately
// after `new Worker(...)` can otherwise race the worker script's own load
// (observed with Turbopack's dev/prod worker wrapper, which sends its own
// unrelated handshake on the same channel first).
worker.postMessage({ type: 'ready' } satisfies ParseWorkerResponse);
