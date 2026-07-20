import type { HistoryEntry } from '../lib/types';

type HistoryPanelProps = {
  /** Applied entries only (appliedHistory(doc)) — the redo tail is not shown. */
  history: HistoryEntry[];
  canUndo: boolean;
  onUndo: () => void;
};

/** Change history + undo (SPECS req 7 / DoD line 5). v1 ships undo only —
 * the model supports redo, but no redo UI yet (see lib/store.ts). */
export function HistoryPanel({ history, canUndo, onUndo }: HistoryPanelProps) {
  return (
    <aside className="history-panel">
      <div className="history-header">
        <h3>History</h3>
        <button type="button" onClick={onUndo} disabled={!canUndo}>
          Undo
        </button>
      </div>
      {history.length === 0 ? (
        <p className="history-empty">No edits yet.</p>
      ) : (
        <ol className="history-list">
          {[...history].reverse().map((entry, i) => (
            <li key={i}>{entry.instruction}</li>
          ))}
        </ol>
      )}
    </aside>
  );
}
