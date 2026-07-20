import { diffWords } from '../lib/diff';
import type { FactFlag } from '../lib/facts/compare';

type DiffViewProps = {
  original: string;
  proposed: string;
  flags: FactFlag[];
};

/** Rung-2 diff (D-012): highlight + warning, never an auto-patch. Flags are
 * shown for review — accepting despite a flag is the user's call (D-013:
 * "flag generously, let the user dismiss"). */
export function DiffView({ original, proposed, flags }: DiffViewProps) {
  const tokens = diffWords(original, proposed);
  return (
    <div className="diff-view">
      <p className="diff-text">
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
      {flags.length > 0 && (
        <ul className="diff-flags">
          {flags.map((f, i) => (
            <li key={i} className="diff-flag">
              ⚠ {f.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
