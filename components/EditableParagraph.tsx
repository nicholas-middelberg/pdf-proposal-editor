'use client';

import { useState } from 'react';
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
  | { kind: 'proposal'; proposed: string; flags: EditProposal['flags'] }
  | { kind: 'error'; message: string };

/** Select a paragraph -> freeform instruction -> call /api/edit -> diff with
 * fact-flags -> accept/reject (D-012). AI failure surfaces inline; the
 * paragraph itself is never mutated except through an explicit accept. */
export function EditableParagraph({ block, onAccept, onReject }: EditableParagraphProps) {
  const [state, setState] = useState<EditState>({ kind: 'idle' });
  const [instruction, setInstruction] = useState('');

  async function submit() {
    if (!instruction.trim()) return;
    setState({ kind: 'loading' });
    try {
      const res = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockId: block.id, text: block.text, instruction }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState({ kind: 'error', message: data.error ?? 'The AI edit failed. Please try again.' });
        return;
      }
      setState({ kind: 'proposal', proposed: data.proposed, flags: data.flags ?? [] });
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
        <DiffView original={block.text} proposed={state.proposed} flags={state.flags} />
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
