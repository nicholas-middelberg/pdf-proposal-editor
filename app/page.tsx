'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DocumentView } from '../components/DocumentView';
import { EditableParagraph } from '../components/EditableParagraph';
import { HistoryPanel } from '../components/HistoryPanel';
import {
  applyEdit,
  canRedo,
  canUndo,
  currentBlocks,
  initDoc,
  recordRejection,
  redo,
  setBlocks,
  undo,
  type DocState,
} from '../lib/store';
import { toMarkdown } from '../lib/export';
import { loadDoc, saveDoc } from '../lib/persistence';
import type { ParseWorkerRequest, ParseWorkerResponse } from '../lib/pdf/parse.worker';
import type { ParseResult, PositionedItem } from '../lib/types';

type Status =
  | { kind: 'idle' }
  | { kind: 'parsing' }
  | { kind: 'error'; message: string }
  | { kind: 'ready' };

type RedetectStatus = { kind: 'idle' } | { kind: 'running' } | { kind: 'error'; message: string };

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
  // The positioned items from the last successful parse — kept around only
  // so "re-detect with AI" (D-003) has something to resend; not otherwise
  // used once blocks exist.
  const [items, setItems] = useState<PositionedItem[] | null>(null);
  const [redetectStatus, setRedetectStatus] = useState<RedetectStatus>({ kind: 'idle' });
  // Non-fatal — the in-memory document keeps working either way; this only
  // warns that a refresh right now could lose work (D-006 silent-failure #4).
  const [persistWarning, setPersistWarning] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Toast queue (visual redesign) — purely a notification layer over the
  // existing accept/reject/undo/redo/export/redetect actions, doesn't touch
  // their logic. Message text is kept even while hidden so the fade-out
  // transition doesn't flash empty content.
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string) => {
    setToastMsg(message);
    setToastVisible(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 2200);
  }, []);

  // Restore a persisted document on mount (DoD: survives a refresh). Done in
  // an effect, not a lazy useState initializer, so the server-rendered and
  // first-client-render markup match (avoids a hydration mismatch) — the
  // cost is one harmless render with the upload prompt before this fires.
  useEffect(() => {
    const persisted = loadDoc();
    if (persisted) {
      setDoc(persisted.doc);
      setItems(persisted.items);
      setStatus({ kind: 'ready' });
    }
  }, []);

  // Persist on every doc/items change — uploads, accept/reject, undo, and
  // re-detect all flow through here via setDoc/setItems.
  useEffect(() => {
    if (!doc || !items) return;
    const result = saveDoc(doc, items);
    setPersistWarning(result.ok ? null : result.error);
  }, [doc, items]);

  // Tracks the active worker + a generation counter so a second upload
  // started while the first is still parsing (a) terminates the stale
  // worker and (b) can never have its late response clobber newer state.
  const workerRef = useRef<Worker | null>(null);
  const generationRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parsing runs in a Web Worker (D-011) — the file's bytes never leave the
  // browser, there is no /api/parse.
  const handleFile = useCallback(async (file: File) => {
    workerRef.current?.terminate();
    const generation = ++generationRef.current;
    const isCurrent = () => generationRef.current === generation;

    setStatus({ kind: 'parsing' });
    setDoc(null);
    setItems(null);
    setRedetectStatus({ kind: 'idle' });

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
            setItems(response.items);
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

  const handleAccept = useCallback(
    (blockId: string, proposed: string, instruction: string) => {
      setDoc((d) => (d ? applyEdit(d, blockId, proposed, instruction) : d));
      showToast('Redline accepted');
    },
    [showToast],
  );

  const handleReject = useCallback(
    (blockId: string, proposed: string, instruction: string) => {
      setDoc((d) => (d ? recordRejection(d, blockId, proposed, instruction) : d));
      showToast('Redline rejected · nothing changed');
    },
    [showToast],
  );

  const handleUndo = useCallback(() => {
    setDoc((d) => (d ? undo(d) : d));
    showToast('Reverted');
  }, [showToast]);

  const handleRedo = useCallback(() => {
    setDoc((d) => (d ? redo(d) : d));
    showToast('Reapplied');
  }, [showToast]);

  // Word-style keyboard shortcuts: Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z redo,
  // Esc closes the history drawer. Undo/redo shortcuts are skipped while
  // focus is in a text field so the instruction input's own native undo
  // (while composing an instruction) isn't hijacked.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isHistoryOpen) {
        setIsHistoryOpen(false);
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) {
        handleRedo();
      } else {
        handleUndo();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isHistoryOpen, handleUndo, handleRedo]);

  const handleExport = useCallback(() => {
    if (!doc) return;
    const markdown = toMarkdown(currentBlocks(doc));
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'proposal.md';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported proposal.md');
  }, [doc, showToast]);

  const handleRedetect = useCallback(async () => {
    if (!items) return;
    setRedetectStatus({ kind: 'running' });
    try {
      const res = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRedetectStatus({ kind: 'error', message: data.error ?? 'Re-detect failed. Please try again.' });
        return;
      }
      const result = data as ParseResult;
      setDoc((d) => (d ? setBlocks(d, result.blocks) : d));
      setRedetectStatus({ kind: 'idle' });
      showToast('Sections re-detected');
    } catch {
      setRedetectStatus({ kind: 'error', message: 'Re-detect failed. Please try again.' });
    }
  }, [items, showToast]);

  const blocks = doc ? currentBlocks(doc) : [];
  // Re-detect is only available before the first edit (Flag A / D-016) — once
  // history exists there's nothing to orphan-proof, so the button is gone.
  const redetectAvailable = doc !== null && doc.history.length === 0;
  const revisionCount = doc ? doc.head + 1 : 0;
  const showUploadView = status.kind !== 'ready' || !doc;

  return (
    <>
      <header className="bar">
        <div className="brand">
          <span className="mark">P</span>
          <span className="name">Proposal Editor</span>
        </div>
        <div className="toolbar">
          <button
            type="button"
            className="btn btn--util"
            disabled={!doc}
            onClick={() => fileInputRef.current?.click()}
          >
            <span className="g">＋</span>
            <span className="lbl-long">New PDF</span>
          </button>
          <button
            type="button"
            className="btn btn--util"
            onClick={handleRedetect}
            disabled={!doc || !redetectAvailable || redetectStatus.kind === 'running'}
            title={
              !doc || redetectAvailable
                ? 'Re-parse this document with AI'
                : 'Re-detect is only available before you start editing'
            }
          >
            <span className="g">⟳</span>
            <span className="lbl-long">{redetectStatus.kind === 'running' ? 'Re-detecting…' : 'Re-detect'}</span>
          </button>
          <button
            type="button"
            className="btn btn--util"
            disabled={!doc}
            onClick={() => setIsHistoryOpen(true)}
          >
            <span className="g">◷</span>
            <span className="lbl-long">History</span>
            {revisionCount > 0 && <span className="count">{revisionCount}</span>}
          </button>
          <button type="button" className="btn btn--util" disabled={!doc} onClick={handleExport}>
            <span className="g">↧</span>
            <span className="lbl-long">Export </span>MD
          </button>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        onChange={onInputChange}
        className="visually-hidden-input"
        aria-label="Upload a proposal PDF"
      />

      <main>
        <div className="stage">
          {showUploadView ? (
            <section className="view-rise">
              <p className="hero-eyebrow">AI-assisted redlining</p>
              <h1 className="hero-title">Edit a proposal the way you&apos;d mark up a plan sheet.</h1>
              <p className="hero-sub">
                Upload a construction proposal. We split it into editable sections — then you ask
                for changes in plain language and review every AI edit as a redline before it
                lands.
              </p>

              <div
                className="drop"
                role="button"
                tabIndex={0}
                aria-label="Upload a proposal PDF"
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
              >
                <div className="ic" aria-hidden="true">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 16V4M12 4 7 9M12 4l5 5" />
                    <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                  </svg>
                </div>
                <h3>Drop a proposal PDF, or choose a file</h3>
                <p>PDF up to 25&nbsp;MB. Sections are detected automatically.</p>
                <button type="button" className="btn btn--primary">
                  Choose file
                </button>
                <span className="filehint">Construction proposal · PDF with a text layer</span>
              </div>

              {status.kind === 'parsing' && <p role="status">Parsing…</p>}
              {status.kind === 'error' && (
                <p role="alert" className="upload-error">
                  {status.message}
                </p>
              )}
            </section>
          ) : (
            <section className="view-rise">
              {persistWarning && (
                <p role="alert" className="persist-warning">
                  {persistWarning}
                </p>
              )}
              {redetectStatus.kind === 'error' && (
                <p role="alert" className="upload-error">
                  {redetectStatus.message}
                </p>
              )}
              <DocumentView
                blocks={blocks}
                renderParagraph={(block, headingText, idx) => (
                  <EditableParagraph
                    block={block}
                    heading={headingText}
                    index={idx}
                    onAccept={handleAccept}
                    onReject={handleReject}
                  />
                )}
              />
            </section>
          )}
        </div>
      </main>

      <HistoryPanel
        history={doc?.history ?? []}
        head={doc?.head ?? -1}
        canUndo={doc !== null && canUndo(doc)}
        canRedo={doc !== null && canRedo(doc)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        open={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        blocks={doc?.blocks ?? []}
      />

      <div className={`toast${toastVisible ? ' show' : ''}`} role="status" aria-live="polite">
        <span className="g">✓</span>
        <span>{toastMsg}</span>
      </div>
    </>
  );
}
