import { diffWords } from '../lib/diff';
import type { FactFlag } from '../lib/facts/compare';
import type { FactKind } from '../lib/facts/extract';

type DiffViewProps = {
  original: string;
  proposed: string;
  flags: FactFlag[];
  onAccept: () => void;
  onReject: () => void;
};

// Short guardrail chip label per fact kind — presentation-only, mirrors
// (but doesn't import) compare.ts's own internal LABEL map.
const TAG_LABEL: Record<FactKind, string> = {
  money: 'dollar amount',
  date: 'date',
  number: 'number',
  name: 'proper noun',
};

/** Rung-2 diff (D-012): highlight + warning, never an auto-patch. Flags are
 * shown for review — accepting despite a flag is the user's call (D-013:
 * "flag generously, let the user dismiss"). Accept = ink (commit), Reject =
 * ghost (dismiss) — never the AI-blue accent, which is reserved for
 * invoking AI, not confirming its output (visual redesign). */
export function DiffView({ original, proposed, flags, onAccept, onReject }: DiffViewProps) {
  const tokens = diffWords(original, proposed);
  return (
    <div className="review">
      <div className="review-head">
        <span className="stamp">Redline</span>
        <span>
          1 requested fix · {flags.length} flagged
        </span>
      </div>
      <p className="redline">
        {tokens.map((t, i) =>
          t.kind === 'removed' ? (
            <del key={i}>{t.text}</del>
          ) : t.kind === 'added' ? (
            <ins key={i}>{t.text}</ins>
          ) : (
            <span key={i}>{t.text}</span>
          ),
        )}
      </p>
      {flags.map((f, i) => (
        <div className="guard" key={i}>
          <span className="flag" aria-hidden="true">
            ⚠
          </span>
          <div className="body">
            <span className="tag">Guardrail · {TAG_LABEL[f.kind]}</span>
            <br />
            {f.message}
          </div>
        </div>
      ))}
      <div className="review-actions">
        <button type="button" className="btn btn--primary" onClick={onAccept}>
          Accept changes
        </button>
        <button type="button" className="btn btn--ghost" onClick={onReject}>
          Reject
        </button>
        <span className="spacer" />
      </div>
    </div>
  );
}
