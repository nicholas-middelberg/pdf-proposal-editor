'use client';

import { useEffect, useRef, useState } from 'react';
import type { Block, EditProposal } from '../lib/types';
import { ParagraphBlock } from './ParagraphBlock';
import { DiffView } from './DiffView';

type EditableParagraphProps = {
  /** Current (composed) block — block.text is the baseline for this edit. */
  block: Block;
  /** Nearest preceding heading's text (lib/blockLabels.ts), or null. */
  heading: string | null;
  /** Running position among paragraphs in the whole document. */
  index: number;
  onAccept: (blockId: string, proposed: string, instruction: string) => void;
  onReject: (blockId: string, proposed: string, instruction: string) => void;
};

type EditState =
  | { kind: 'idle' }
  | { kind: 'selected' }
  | { kind: 'loading' }
  | { kind: 'proposal'; proposed: string; flags: EditProposal['flags']; baseline: string }
  | { kind: 'error'; message: string };

/** Select a paragraph -> freeform instruction -> call /api/edit -> diff with
 * fact-flags -> accept/reject (D-012). AI failure surfaces inline; the
 * paragraph itself is never mutated except through an explicit accept. The
 * block-label (heading + index) stays visible across every state — only the
 * body/editor/review "slot" underneath it switches (visual redesign). */
export function EditableParagraph({
  block,
  heading,
  index,
  onAccept,
  onReject,
}: EditableParagraphProps) {
  const [state, setState] = useState<EditState>({ kind: 'idle' });
  const [instruction, setInstruction] = useState('');
  const [flash, setFlash] = useState(false);

  // Mirrors the latest block.text on every render so an in-flight request
  // can tell, once it resolves, whether the paragraph changed underneath it
  // (e.g. an undo elsewhere reverted this block while the request was out).
  const latestTextRef = useRef(block.text);
  latestTextRef.current = block.text;

  // If an open proposal's baseline no longer matches the block's current
  // text, drop it. Its fact-flags were computed against the OLD baseline —
  // accepting it would silently apply an edit that was never validated
  // against what is now the immediate prior text (D-013/D-015).
  useEffect(() => {
    if (state.kind === 'proposal' && state.baseline !== block.text) {
      setState({ kind: 'idle' });
      setInstruction('');
    }
  }, [block.text, state]);

  async function submit() {
    if (!instruction.trim()) return;
    const baseline = block.text;
    setState({ kind: 'loading' });
    try {
      const res = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockId: block.id, text: baseline, instruction }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState({ kind: 'error', message: data.error ?? 'The AI edit failed. Please try again.' });
        return;
      }
      if (latestTextRef.current !== baseline) {
        // Superseded while in flight — the response was validated against a
        // baseline that's no longer current. Discard rather than show a
        // proposal that could be accepted against the wrong prior text.
        setState({ kind: 'idle' });
        setInstruction('');
        return;
      }
      setState({ kind: 'proposal', proposed: data.proposed, flags: data.flags ?? [], baseline });
    } catch {
      setState({ kind: 'error', message: 'The AI edit failed. Please try again.' });
    }
  }

  function accept() {
    if (state.kind !== 'proposal') return;
    onAccept(block.id, state.proposed, instruction);
    setState({ kind: 'idle' });
    setInstruction('');
    setFlash(true);
    setTimeout(() => setFlash(false), 1600);
  }

  function reject() {
    if (state.kind !== 'proposal') return;
    onReject(block.id, state.proposed, instruction);
    setState({ kind: 'idle' });
    setInstruction('');
  }

  function cancel() {
    setState({ kind: 'idle' });
    setInstruction('');
  }

  const blockLabel = (
    <p className="block-label">
      <span className="idx">{String(index).padStart(2, '0')}</span>
      {heading}
    </p>
  );

  return (
    <article className={`block${flash ? ' flash-ok' : ''}`}>
      {state.kind === 'idle' && (
        <div className="block-tools">
          <button
            type="button"
            className="edit-btn"
            aria-label="Edit this section"
            onClick={() => setState({ kind: 'selected' })}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m16.5 3.5 4 4L7 21l-4 1 1-4Z" />
            </svg>
            Edit
          </button>
        </div>
      )}
      {blockLabel}

      {state.kind === 'idle' && <ParagraphBlock block={block} />}

      {state.kind === 'selected' && (
        <div className="editor">
          <p className="block-body">{block.text}</p>
          <div className="promptrow">
            <label className="promptbox">
              <span className="spark" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6L12 2z" />
                </svg>
              </span>
              <input
                type="text"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder="Tell the assistant what to change…"
                autoComplete="off"
                autoFocus
              />
            </label>
            <div className="editor-actions">
              <button
                type="button"
                className="btn btn--accent"
                onClick={submit}
                disabled={!instruction.trim()}
              >
                Ask AI
              </button>
              <button type="button" className="btn btn--ghost" onClick={cancel}>
                Cancel
              </button>
            </div>
          </div>
          <p className="hintline">
            Edits arrive as a redline you approve. <span className="kbd">⏎</span> to run
          </p>
        </div>
      )}

      {state.kind === 'loading' && (
        <div className="editor">
          <p className="block-body" style={{ opacity: 0.5 }}>
            {block.text}
          </p>
          <div className="thinking">
            <span className="dots">
              <i></i>
              <i></i>
              <i></i>
            </span>
            Drafting a redline · checking proper nouns
          </div>
        </div>
      )}

      {state.kind === 'error' && (
        <div className="editor">
          <p className="block-body">{block.text}</p>
          <div className="promptrow">
            <label className="promptbox">
              <span className="spark" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6L12 2z" />
                </svg>
              </span>
              <input
                type="text"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder="Tell the assistant what to change…"
                autoComplete="off"
              />
            </label>
            <div className="editor-actions">
              <button
                type="button"
                className="btn btn--accent"
                onClick={submit}
                disabled={!instruction.trim()}
              >
                Ask AI
              </button>
              <button type="button" className="btn btn--ghost" onClick={cancel}>
                Cancel
              </button>
            </div>
          </div>
          <p role="alert" className="upload-error">
            {state.message}
          </p>
        </div>
      )}

      {state.kind === 'proposal' && (
        <DiffView
          original={state.baseline}
          proposed={state.proposed}
          flags={state.flags}
          onAccept={accept}
          onReject={reject}
        />
      )}
    </article>
  );
}
