import type { HistoryEntry } from '../lib/types';

type HistoryPanelProps = {
  /** Full history array (append-only) — includes undone (redo-tail)
   * entries, distinguished from applied ones via `head`. */
  history: HistoryEntry[];
  /** Index of the last applied entry; entries with index > head are undone. */
  head: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
};

/** Change history + undo/redo (SPECS req 7 / DoD line 5; Word-style redo).
 * `redo` moves `head` back right over an entry that's still in the array
 * (lib/store.ts) — undoing never deletes anything, so the redo tail stays
 * visible here, dimmed, until a new edit truncates it. */
export function HistoryPanel({ history, head, canUndo, canRedo, onUndo, onRedo }: HistoryPanelProps) {
  return (
    <aside className="history-panel">
      <div className="history-header">
        <h3>History</h3>
        <div className="history-buttons">
          <button type="button" onClick={onUndo} disabled={!canUndo}>
            Undo
          </button>
          <button type="button" onClick={onRedo} disabled={!canRedo}>
            Redo
          </button>
        </div>
      </div>
      {history.length === 0 ? (
        <p className="history-empty">No edits yet.</p>
      ) : (
        <ol className="history-list">
          {history
            .map((entry, i) => ({ entry, i }))
            .reverse()
            .map(({ entry, i }) => (
              <li key={i} className={i <= head ? 'history-applied' : 'history-undone'}>
                {entry.instruction}
              </li>
            ))}
        </ol>
      )}
    </aside>
  );
}
