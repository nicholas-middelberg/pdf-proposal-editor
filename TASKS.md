# TASKS.md — AI proposal editor (v1)

## Context

This is the task plan for the take-home in SPECS.md / DECISIONS.md. Scope is
**exactly** the "Definition of done" checklist in SPECS.md — nothing more. The
decision log is rationale and stretch-reachability, not a scope commitment, so
no stretch items are built (KB grounding, multi-column XY-cut, server
persistence all stay out).

The task **order** is deliberately risk-weighted, per the build constraints:
the edit/compose/undo/history state machine is the least-tested (D-009) and
highest bug-density (D-015) part, so it is built and unit-tested *first* —
before the parser, before any UI — against synthetic `Block` fixtures so it
does not wait on the PDF pipeline. The content-derived `Block.id` contract
(D-015) is pinned in Task 1 because everything downstream keys on it.

---

## Guardrails carried through every task (from the docs)

- **Token safety (non-negotiable, D-010/D-011):** `PROXY_TOKEN` lives in
  `.env.local`, read *only* inside `/app/api/edit/route.ts`. Never
  `NEXT_PUBLIC_*`, never imported by a client component.
  - **Never committed to git.** `.gitignore` ignores `.env.local` and
    `.env*.local` (Next.js's default `.gitignore` already does — verify it's
    present, don't assume). Only `.env.example` is tracked, and it holds the
    **variable name with an empty/placeholder value, never a real token**.
  - **Verified, not assumed:** `git check-ignore .env.local` returns the path;
    `git ls-files` shows no `.env*.local`; a tracked-file scan for the token
    value is clean. These run in Task 1 (setup) and Task 11 (pre-deploy).
  - The real token is provided out-of-band and pasted only into local
    `.env.local` and Vercel's encrypted env-var settings — never into a file
    that git tracks.
- **One server route only (D-011):** `/api/edit`. No `/api/parse` — the PDF is
  read via the File API and parsed in a Web Worker; it never crosses the wire.
- **`Block.id` is content-derived, not positional (D-015):** hash(text + page)
  with an occurrence-index tie-break for repeated boilerplate. Pinned Task 1.
- **Validator baseline = immediate prior text, not the pristine parse (D-015).**
- **"Unlicensed change" ≠ bare diff (D-013):** flag only entity changes the
  instruction did not license, or every edit becomes noise.
- **No streaming in v1 (D-010).** Plain "editing…" state.
- **Metered spend (D-010):** edit call sends one paragraph, never the document.

---

## Task list

### Task 1 — Bootstrap + pinned type contracts *(prereq plumbing; pins the id contract)*
- Scaffold Next.js + TypeScript (App Router), Vitest, Vercel-ready config.
- `.env.example` documents `PROXY_TOKEN` (name only, placeholder value);
  confirm `.gitignore` ignores `.env.local` + `.env*.local` (Next.js default —
  verify). Prove it: `git check-ignore .env.local` resolves and `git ls-files`
  lists no env-local file. The real token never enters a tracked file.
- Define core interfaces from SPECS in `lib/types.ts`: `Block`, `ParseResult`,
  `EditRequest`, `EditProposal`, `HistoryEntry`.
- Align the fixtures path: move/point `proposals/` → `/fixtures/` to match SPECS
  (Flag D).
- **Pin `Block.id`:** implement + unit-test the content-derived id (hash of
  `text + page`) with the collision tie-break (append occurrence index) so two
  identical lines never share an id (D-015). This is the contract Task 2's
  history keys on — it goes here, first.

### Task 2 — Edit-state machine *(THE RISK — built first, D-015 + D-009)*
**Pointer-based linear history — array + HEAD, NOT a pop/discard stack.**
D-015's "linear stack with per-step baseline" is implemented as:
- History is an **array of edit entries** plus a **`HEAD` index** (per paragraph,
  or a document-wide log keyed by `blockId` — decided in-task, but the array+HEAD
  invariant is fixed here).
- **Undo = move `HEAD` left** (decrement). The entry is **not** popped or
  deleted — it stays in the array so it remains re-applicable.
- **Redo = move `HEAD` right** (increment). *(Model supports it; no v1 UI — see
  scope below.)*
- **New edit while `HEAD` is not at the end = truncate-right:** discard entries
  after `HEAD`, append the new entry, advance `HEAD` (Word's behavior — a new
  action clears the redo path).
- **Current document text is derived by applying entries `[0..HEAD]`.**
- **Per-step baseline (D-015) holds:** an edit validates against the text **at
  `HEAD`** (immediate prior state), not the original parse — this is the baseline
  Task 3's validator reads.

Also: `applyEdit` composes onto prior text; a second edit composes on the first
(DoD line 4); accept **and** reject are both recorded.

**v1 scope — ship UNDO only.** Build the full pointer model, but expose only
undo in the UI. Redo button/shortcut and the scrubbable timeline are **not** in
v1 (see Stretch items). Because the model is pointer-based from the start, both
are later pure-UI additions over `HEAD` movement — no history-data-structure
change.

- **Unit-tested even though D-009 only mandates parser tests** — highest
  bug-density surface. Tests assert the pointer invariants directly: undo
  decrements without deleting, redo re-applies, a new edit after undo truncates
  the tail, and text = apply `[0..HEAD]`. Developed against hand-made synthetic
  `Block[]` fixtures so it does **not** block on the parser.

### Task 3 — Fact extraction + comparison module *(shared runtime + eval, D-013)*
- `lib/facts/extract.ts`: regex for number / date / $ / name. Numbers/dates/$
  are near-perfect recall; name extraction is knowingly weak (capitalized runs).
- `lib/facts/compare.ts`: `compare(priorText, editText, instruction) → flags`.
  Baseline is the **immediate prior text** (D-015), and the rule is
  **"entity changed that the instruction didn't license,"** not a bare diff
  (D-013) — over-warn, user dismisses. Split reporting: number/date/$ separate
  from name, never blended.
- Pure + unit-tested. One code path, consumed by both `/api/edit` and the eval.

### Task 4 — PDF parse pipeline *(where D-009 tests are mandated)*
- `lib/pdf/extract.ts`: `unpdf` → positioned items `{text, x, y, bbox, page}`.
  Keep `bbox` on every block (D-004) though v1 ignores x-position.
- `lib/pdf/segment.ts`: **pure** items→`Block[]` (font-size jumps, numbering,
  all-caps, whitespace gaps; read in document order). **Unit-tested against
  easy.pdf** — the D-009 requirement.
- `lib/pdf/parse.worker.ts`: runs extract+segment off the main thread.
- Guards: reject non-PDF; near-zero-char no-text-layer detection → clear error
  (D-008) — verify it fires end-to-end on the **user-supplied** scanned fixture
  (Flag D; blocks the DoD scanned-PDF line until that file is provided).
- **Measure the paragraph-length distribution from easy.pdf** and set the
  edit-call length cap to ≈3–4× the longest genuine paragraph (Flag B). Record
  the chosen constant.

### Task 5 — `/api/edit` route *(token holder, rung-2, D-010/D-012)*
- Server-only. Anthropic SDK, `baseURL` → proxy, `apiKey: process.env.PROXY_TOKEN`.
- **Pin the exact model string** and record it in README/SPECS (no floating
  alias). Verify the pinned id is served by the proxy on first run.
- One completion per edit (no streaming). System prompt: proposal-editor role,
  forbids changing facts unless instructed, returns the revised paragraph only.
- Runs the Task 3 validator on the complete edit before returning `EditProposal`.
- **Length guard on the paragraph** before the call — block over the
  fixture-derived cap and block empty; never truncate (Flag B).
- Logs `{original, instruction, edit}` triples so the eval can replay offline.

### Task 6 — Upload + document view UI
- Upload via File API → Web Worker parse. Reject non-PDF and no-text with an
  inline error (not a crash).
- `DocumentView` + `ParagraphBlock` render blocks in document order. Headings
  are **navigation/grouping only**; the paragraph is the editable unit (D-002).

### Task 7 — Edit flow + diff + history panel + re-detect
- Select paragraph → freeform instruction → call `/api/edit` → `DiffView` with
  fact-flags surfaced (rung-2: highlight + warning, no auto-patch, D-012).
- Accept applies + records; reject discards + records. AI failure → inline error
  on the paragraph, paragraph unchanged.
- `HistoryPanel` with undo (DoD line 5).
- "Re-detect sections with AI" button — sends **positioned items `{text,x,y}`,
  not flat text** (D-003). **Enabled only while `history.length === 0`**;
  disabled with a tooltip once the first edit is accepted (Flag A, D-016).

### Task 8 — Persistence (localStorage, D-006)
- Persist `Block[]` + history (+ positioned items so re-detect survives refresh).
  **Never persist PDF bytes.** Wrap writes; on quota failure surface a warning
  rather than losing work silently (SPECS silent-failure #4).
- Document + history survive a refresh (DoD line 6).

### Task 9 — Export (D-001)
- Export current document state (all accepted edits composed) as markdown/text.

### Task 10 — Eval script (D-013 / Req 5)
- `scripts/eval.ts`: parse easy.pdf, run a fixed batch of fact-neutral
  instructions ("tighten this", "make it more formal", "fix grammar"), diff
  extracted facts in vs. out via the Task 3 module, print **both** fidelity
  rates (number/date/$ and name, separate) + real worked examples. Not wired
  into `npm test` (makes live calls). Output pasted into README.
- `facts-mini/` fixture (Flag C): build **only if time remains after Tasks
  1–9** to add a false-positive number; otherwise cut and note in README.

### Task 11 — Deploy + DoD verification
- Deploy to Vercel. Walk the full DoD checklist on the **deployed** app.
- Token-exposure checks all clean: `grep -r "$PROXY_TOKEN" .next/static`
  (client bundle) **and** a scan of git-tracked files + history for the token
  value (`git grep` on the tree; `git log -p | grep` spot-check) return nothing;
  `git ls-files` lists no `.env*.local`.
- README: pinned model, both fidelity numbers + examples, and the stated
  limitations (validator baseline = prior text so cumulative drift isn't
  checked (D-015); name fidelity is a floor (D-013)).

---

## Post-v1 stretch (explicitly NOT built now)
- **Redo button/shortcut** — UI-only, builds on the existing `HEAD` model
  (redo = move `HEAD` right). No history-data-structure change.
- **Scrubbable history timeline** — UI-only, builds on the existing `HEAD` model
  (render entries `[0..n]`, let the user set `HEAD`). No data-structure change.
- (Also from the docs, unchanged: KB grounding, multi-column XY-cut reading
  order, server-side persistence — all out of v1.)

---

## Flags — ALL RESOLVED

> Dependency: the DoD scanned-PDF line is blocked until a scanned/no-text
> fixture is supplied (Flag D).

### Flag A — Re-detect's effect on history — RESOLVED
**Re-detect is available only before the first edit.** The button is enabled
while history is empty (zero accepted edits); disabled with a tooltip once the
first edit is accepted. No merge/split history-migration problem can arise —
there is no history to orphan. `Block.id` stays content-derived (keying
contract), but the "survives re-detect" justification is dropped. Recorded as
**D-016** + amendment to D-015; SPECS Req 4 updated. Lands in Task 7.

### Flag B — Paragraph-length cap — RESOLVED
**The cap is a mis-merge tripwire, not a model-performance limit.** No quality
cliff at paragraph scale; the cap catches parser failures, keeps the fact
validator's surface small, and bounds outlier cost. Threshold is **derived from
easy.pdf** (≈3–4× the longest genuine paragraph; placeholder ~6k chars until
measured). On exceed: **block with an inline message, never truncate** (would
silently drop facts). Empty also blocked. Lands in Tasks 4/5/7.

### Flag C — `facts-mini/` eval fixture — RESOLVED
**Build only if time remains after Tasks 1–9.** Ship the live easy-fixture eval
(false negatives) first; `facts-mini` is the only way to measure false positives
— add it iff budget remains, otherwise cut and note the unmeasured FP rate in
the README. Lands in Task 10.

### Flag D — Scanned fixture + path mismatch — RESOLVED
- **Scanned fixture: user provides one** in the fixtures dir; the D-008 guard
  test is wired to it end-to-end. Blocks the DoD scanned-PDF line until supplied.
- **Path: align `proposals/` → `/fixtures/`** during Task 1.

---

## Verification (end-to-end, on the deployed app against easy.pdf)
Runs the SPECS Definition-of-done checklist: parse → edit → diff accept/reject →
second edit composes → undo → refresh persists → scanned PDF errors cleanly →
markdown export reflects edits → `npm test` (parser) passes → token absent from
`.next/static` → `scripts/eval.ts` prints both fidelity rates + examples.
