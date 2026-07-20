'use client';

import { useCallback, useRef, useState } from 'react';
import { DocumentView } from '../components/DocumentView';
import { currentBlocks, initDoc, type DocState } from '../lib/store';
import type { ParseWorkerRequest, ParseWorkerResponse } from '../lib/pdf/parse.worker';

type Status =
  | { kind: 'idle' }
  | { kind: 'parsing' }
  | { kind: 'error'; message: string }
  | { kind: 'ready' };

// Ignore anything that isn't our own protocol — the dev/prod worker wrapper
// can put its own unrelated messages on this same channel.
function isOurMessage(data: unknown): data is ParseWorkerResponse {
  return (
    !!data &&
    typeof data === 'object' &&
    'type' in data &&
    (data.type === 'ready' || data.type === 'success' || data.type === 'error')
  );
}

export default function Home() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [doc, setDoc] = useState<DocState | null>(null);

  // Tracks the active worker + a generation counter so a second upload
  // started while the first is still parsing (a) terminates the stale
  // worker and (b) can never have its late response clobber newer state.
  const workerRef = useRef<Worker | null>(null);
  const generationRef = useRef(0);

  // Parsing runs in a Web Worker (D-011) — the file's bytes never leave the
  // browser, there is no /api/parse.
  const handleFile = useCallback(async (file: File) => {
    workerRef.current?.terminate();
    const generation = ++generationRef.current;
    const isCurrent = () => generationRef.current === generation;

    setStatus({ kind: 'parsing' });
    setDoc(null);

    try {
      const worker = new Worker(new URL('../lib/pdf/parse.worker.ts', import.meta.url));
      workerRef.current = worker;

      // Wait for the worker's own explicit ready signal before posting the
      // parse request — posting immediately after `new Worker(...)` can race
      // the worker script's own load and get silently dropped. Also settles
      // (rejects) if the worker fails before ever getting there, so this
      // can't hang forever waiting for a ready signal that will never come.
      await new Promise<void>((resolve, reject) => {
        worker.addEventListener('message', function onFirstMessage(event: MessageEvent) {
          if (!isOurMessage(event.data) || event.data.type !== 'ready') return;
          worker.removeEventListener('message', onFirstMessage);
          resolve();
        });
        worker.addEventListener('error', function onFirstError() {
          worker.removeEventListener('error', onFirstError);
          reject(new Error('Worker failed to start.'));
        });
      });

      worker.onmessage = (event: MessageEvent) => {
        if (!isOurMessage(event.data) || event.data.type === 'ready') return;
        if (isCurrent()) {
          const response = event.data;
          if (response.type === 'success') {
            setDoc(initDoc(response.blocks));
            setStatus({ kind: 'ready' });
          } else {
            setStatus({ kind: 'error', message: response.message });
          }
        }
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      };

      worker.onerror = () => {
        if (isCurrent()) {
          setStatus({ kind: 'error', message: 'Could not parse this PDF.' });
        }
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      };

      const data = await file.arrayBuffer();
      if (!isCurrent()) {
        worker.terminate(); // superseded by a newer upload while reading the file
        return;
      }
      const request: ParseWorkerRequest = { type: 'parse', data };
      worker.postMessage(request, [data]); // transfer, not copy
    } catch {
      if (isCurrent()) {
        setStatus({ kind: 'error', message: 'Could not parse this PDF.' });
      }
      workerRef.current?.terminate();
      workerRef.current = null;
    }
  }, []);

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file later
    if (file) void handleFile(file);
  };

  return (
    <main>
      <h1>AI Proposal Editor</h1>
      <label className="upload-control">
        <span>Upload a construction proposal PDF to begin.</span>
        <input type="file" accept="application/pdf" onChange={onInputChange} />
      </label>

      {status.kind === 'parsing' && <p role="status">Parsing…</p>}
      {status.kind === 'error' && (
        <p role="alert" className="upload-error">
          {status.message}
        </p>
      )}
      {status.kind === 'ready' && doc && <DocumentView blocks={currentBlocks(doc)} />}
    </main>
  );
}
