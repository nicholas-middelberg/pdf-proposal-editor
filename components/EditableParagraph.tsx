'use client';

import { useEffect, useRef, useState } from 'react';
import type { Block, EditProposal } from '../lib/types';
import { ParagraphBlock } from './ParagraphBlock';
import { DiffView } from './DiffView';

type EditableParagraphProps = {
  /** Current (composed) block — block.text is the baseline for this edit. */
  block: Block;
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
 * paragraph itself is never mutated except through an explicit accept. */
export function EditableParagraph({ block, onAccept, onReject }: EditableParagraphProps) {
  const [state, setState] = useState<EditState>({ kind: 'idle' });
  const [instruction, setInstruction] = useState('');

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

  if (state.kind === 'proposal') {
    return (
      <div className="paragraph-slot paragraph-editing">
        <DiffView original={state.baseline} proposed={state.proposed} flags={state.flags} />
        <div className="edit-controls">
          <button type="button" onClick={accept}>
            Accept
          </button>
          <button type="button" onClick={reject}>
            Reject
          </button>
        </div>
      </div>
    );
  }

  if (state.kind === 'idle') {
    return (
      <div className="paragraph-slot">
        <ParagraphBlock block={block} />
        <button type="button" className="edit-trigger" onClick={() => setState({ kind: 'selected' })}>
          Edit
        </button>
      </div>
    );
  }

  const loading = state.kind === 'loading';
  return (
    <div className="paragraph-slot paragraph-editing">
      <ParagraphBlock block={block} />
      <div className="edit-controls">
        <input
          type="text"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="e.g. tighten this, fix the client name to..."
          disabled={loading}
        />
        <button type="button" onClick={submit} disabled={loading || !instruction.trim()}>
          {loading ? 'Editing…' : 'Ask AI'}
        </button>
        <button type="button" onClick={cancel} disabled={loading}>
          Cancel
        </button>
      </div>
      {state.kind === 'error' && (
        <p role="alert" className="upload-error">
          {state.message}
        </p>
      )}
    </div>
  );
}
