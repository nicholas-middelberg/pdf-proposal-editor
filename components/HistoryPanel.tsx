import { labelBlocks } from '../lib/blockLabels';
import { diffWords } from '../lib/diff';
import type { Block, HistoryEntry } from '../lib/types';

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
  open: boolean;
  onClose: () => void;
  /** Current document blocks — resolves each entry's section label. */
  blocks: Block[];
};

/** Change history + undo/redo (SPECS req 7 / DoD line 5; Word-style redo),
 * as a right slide-over drawer (visual redesign). `redo` moves `head` back
 * right over an entry that's still in the array (lib/store.ts) — undoing
 * never deletes anything, so the redo tail stays visible here, dimmed,
 * until a new edit truncates it. This intentionally diverges from the
 * reference mock's toy demo, which makes undone entries vanish instead —
 * our already-shipped dimmed-tail behavior is preserved. */
export function HistoryPanel({
  history,
  head,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  open,
  onClose,
  blocks,
}: HistoryPanelProps) {
  const labels = labelBlocks(blocks);

  function sectionLabel(blockId: string): string {
    return labels.get(blockId)?.heading ?? 'Untitled section';
  }

  function counts(entry: HistoryEntry): { adds: number; dels: number } {
    const tokens = diffWords(entry.from, entry.to);
    return {
      adds: tokens.filter((t) => t.kind === 'added').length,
      dels: tokens.filter((t) => t.kind === 'removed').length,
    };
  }

  return (
    <>
      <div className={`scrim${open ? ' show' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={`drawer${open ? ' open' : ''}`} aria-label="Edit history" aria-hidden={!open}>
        <div className="drawer-head">
          <h3>History</h3>
          <div className="drawer-head-actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={onUndo} disabled={!canUndo}>
              Undo
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={onRedo} disabled={!canRedo}>
              Redo
            </button>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close history">
              ×
            </button>
          </div>
        </div>
        <div className="drawer-body">
          {history.length === 0 ? (
            <div className="hist-empty">
              <div className="ic" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </div>
              <p>No edits yet.</p>
              <span>Accepted redlines show up here as a revision trail.</span>
            </div>
          ) : (
            <>
              <p className="drawer-sub">
                {history.length} revision{history.length > 1 ? 's' : ''}
              </p>
              <ol className="timeline">
                {history
                  .map((entry, i) => ({ entry, i }))
                  .reverse()
                  .map(({ entry, i }) => {
                    const { adds, dels } = counts(entry);
                    const isCurrent = i === head;
                    const isUndone = i > head;
                    return (
                      <li
                        key={i}
                        className={`rev${isCurrent ? ' current' : ''}${isUndone ? ' undone' : ''}`}
                      >
                        <div className="revlabel">{entry.instruction}</div>
                        <div className="revmeta">
                          <span className="rr">R{i + 1}</span>
                          <span>{sectionLabel(entry.blockId)}</span>
                          <span>
                            <span className="st-add">+{adds}</span> <span className="st-del">−{dels}</span>
                          </span>
                          <span>
                            {new Date(entry.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                          </span>
                          {isCurrent && <span className="curtag">current</span>}
                        </div>
                      </li>
                    );
                  })}
              </ol>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
