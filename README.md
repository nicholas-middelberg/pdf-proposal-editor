# AI Proposal Editor

Upload a construction proposal PDF, get it back as editable paragraphs, ask AI
to change any paragraph in plain language, review every edit as a redline, and
accept or reject it. Accepted edits compose, are undoable, survive a refresh,
and export to markdown.

**Live:** https://pdf-proposal-editor.vercel.app/

This README is self-contained. Deeper rationale lives in [DECISIONS.md](DECISIONS.md)
(ADR-style, `D-0XX` references below point there); scope and the
definition-of-done checklist are in [SPECS.md](SPECS.md).

---

## 1. Setup & run

**Prerequisites:** Node 20.6+ (the eval scripts use `node --env-file`; developed
and tested on 22), npm.

```bash
git clone https://github.com/nicholas-middelberg/pdf-proposal-editor.git
cd pdf-proposal-editor
npm install

cp .env.example .env.local
# paste the hiring-proxy token into .env.local as PROXY_TOKEN=...

npm run dev          # http://localhost:3000
```

Then upload `fixtures/easy.pdf` (or any text-layer PDF).

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm test` | 102 unit tests (parser, edit-state machine, fact comparison, persistence, diff). No network, no API calls. |
| `npm run build` | Production build |
| `npm run eval` | Fidelity eval, calling the model directly. **Makes ~114 live API calls.** |
| `npm run eval:deployed` | Same eval against the **deployed** `/api/edit`. **Makes ~114 live API calls.** |

Neither eval is wired into `npm test` — they cost money and hit the network.

**Token safety.** `PROXY_TOKEN` is read only inside `app/api/edit/route.ts`, is
never prefixed `NEXT_PUBLIC_`, and is never imported by a client component.
`.env.local` is gitignored; only `.env.example` (name, no value) is tracked. On
Vercel it's an encrypted environment variable. Verified before shipping: the
token value appears in neither the deployed client bundle, nor any tracked
file, nor git history.

**Model:** pinned to `claude-sonnet-5` in `lib/ai.ts` — an exact string, not a
floating alias, so a provider-side alias change can't silently alter behavior.

---

## 2. Design decisions

### PDF representation

**Parsing happens in the browser, in a Web Worker. The file never crosses the
wire.** There is no `/api/parse` — the only server route is the one that has to
exist because it holds the token. Consequences: Vercel's 4.5 MB request-body
limit never applies (`hard.pdf` is 17.5 MB), there's no upload latency, and the
PDF bytes never touch a server we'd then have to reason about retaining.

**Extraction keeps coordinates from day one (D-004).** `unpdf` (a pdf.js
wrapper) yields positioned items — `{text, x, y, bbox, page, fontSize}` — rather
than the flat string `pdf-parse` would give. This was the highest-leverage
call in the project: PDFs don't store text in reading order, they store drawing
instructions, and **x-position is the only signal that columns exist.** A
flat-text library discards that permanently, turning multi-column support from
a feature into a rewrite. v1 ignores x when grouping lines; the data is there
anyway.

**Segmentation is a pure, unit-tested function** (`lib/pdf/segment.ts`):
font-size jumps, numbering patterns (`1.`, `2.1`, `SECTION 3`), all-caps lines,
and vertical whitespace gaps turn positioned items into ordered
`Block[]` of `heading | paragraph`. Being pure means the real fixture doubles as
free test data.

**`Block.id` is content-derived, not positional (D-015)** — a hash of
`text + page` with an occurrence-index tie-break so two identical boilerplate
lines never collide. Array indices break the moment a re-detect merges or
splits a paragraph; every downstream structure (history, diffs, persistence)
keys on this id.

### Agent design

**One route, two request shapes.** `/api/edit` handles both a paragraph edit
and the AI re-detect, dispatching on the request body. A second route would
have meant a second place the token lives.

**Edit calls send one paragraph, never the document.** Spend is metered, and a
per-paragraph call also keeps the validator's surface small enough to reason
about.

**No streaming (D-010).** The fact validator needs the *complete* edit before a
diff can be rendered, so streaming would only buy "watch it type" — not "act on
it sooner."

**Validation is deterministic and server-side, and never auto-patches (D-012).**
After the model returns, `lib/facts/compare.ts` extracts numbers, dates, dollar
amounts, and names from both the baseline and the edit, and flags any change the
instruction didn't license. "Licensed" is deliberately *not* a bare diff —
legitimate edits do change facts ("fix the client name to Acme") — so the rule
is a mutation verb plus a category cue, or the new value appearing literally in
the instruction. The design **over-warns on purpose**: a false positive costs
the user a glance, a false negative is the silent failure the product exists to
prevent. Flags are surfaced for review; the human decides.

**The re-detect model can't author text (D-003).** It receives positioned items
as `{i, text, x, y, page}` and returns *only* groupings —
`{type, itemIndices[]}`. The server rebuilds blocks from the original item text
at those indices. So a bad response can misgroup or misorder, but it structurally
**cannot hallucinate new paragraph content into the proposal.** Re-detect is
also gated to before the first edit (D-016), which removes the entire class of
"re-segmentation orphaned my edit history" problems rather than solving it.

### UX

**The paragraph is the editable unit; headings are navigation only (D-002).**
The brief's "section by section" is ambiguous between the two. One granularity
means one selection model, one diff model, one history model — two would mean
competing state. The cost is no "rewrite this whole section" action.

**History is a pointer, not a stack.** `history` is an append-only array plus a
`head` index. Undo moves `head` left; **the entry is never deleted**, so it stays
re-applicable. Redo moves `head` right. A new edit while `head` isn't at the end
truncates the tail, then appends — Word's behavior. Because the model was built
this way from the start, adding redo later was a pure UI change with no
data-structure migration.

**The validation baseline is the immediate prior text, not the pristine parse
(D-015).** Editing twice means the second edit is checked against the first
edit's output — what the user is actually looking at. (This has a real cost; see
cumulative drift in §4.)

**Visual language carries meaning.** One accent color (drafting blue) is
reserved exclusively for *invoking AI*; ink = commit (Accept), outline = dismiss
(Reject/Cancel). Green/red/amber appear only inside the redline and its
guardrail warnings, so color is never decorative — if you see amber, something
needs your judgment.

---

## 3. What I cut and why

Ordered roughly by how much the cut cost.

**`facts-mini` — the hand-labeled eval fixture. The most costly cut.** ~10 short
paragraphs with known embedded facts, paired with instructions that are
*explicitly* fact-neutral or fact-licensing. It is the only way to get
ground-truth "licensed" labels, and therefore the only way to measure **false
positives**. Without it the eval measures leaks (false negatives) but has no
denominator for over-warning — which is precisely why the name number in §5
can't be read at face value. Cut for time; it's the first thing I'd add back.

**Multi-column reading order (XY-cut).** `hard.pdf` is two-column and the
deterministic parser interleaves it. The fix is well-understood and scoped —
project item x-ranges, find the vertical gutter, split, sort each side by y —
maybe an afternoon on data already captured. Cut because the definition-of-done
runs on `easy.pdf` and this is a parser sub-project with its own tuning surface.
The AI re-detect path partially covers it; the deterministic path does not.

**Knowledge-base grounding (D-005).** Raised alongside "rewrite" and "fix tone,"
but it's a second product (ingest, chunk, retrieve), not a prompt variant. When
built it needs no RAG — a proposal-boilerplate KB fits in context, so
preprocessing it to JSON and injecting it behind an explicit user action beats a
retrieval stack we'd have to maintain.

**Auto-patching flagged facts.** Considered and deliberately rejected. The
product's entire thesis is that a human decides what lands in a bid document;
silently repairing a flagged change would reintroduce exactly the trust problem
the flag exists to expose.

**Automatic retry on a malformed re-detect response.** Rejected on latency: a
re-detect call already takes 30–90+ seconds, so a retry doubles the worst case.
Chose salvage instead — see §4.

**Layout fidelity, tables, .docx/PDF export (D-001).** Export is markdown. This
removes an entire subsystem (layout reconstruction) for the price of one honest
limitation. An AEC reviewer *will* notice the formatting is gone; that's only
defensible as a stated non-goal, which is why it's stated.

**OCR / scanned PDFs.** Explicitly detected and refused with a clear error
rather than half-supported (see §4).

**Streaming, server-side persistence, auth, multi-user, collaboration,
versioned server documents.** All out of scope; localStorage covers the
"survives a refresh" requirement with zero backend.

---

## 4. Failure modes I worried about

**Loud failures** — these already fail visibly and were built for: non-PDF
upload, no-text-layer PDF, over-length paragraph (a mis-merge tripwire set at
4800 chars, ~4× the longest genuine paragraph measured in `easy.pdf` — it blocks
rather than truncates, because truncation silently drops trailing facts),
malformed/empty AI response, and network failure. Each surfaces inline and
leaves the paragraph unchanged.

The dangerous ones are the **silent** failures — where the app produces a
plausible-looking wrong result and nothing signals it.

1. **The AI changes a fact it wasn't asked to change.** The headline risk: a
   "tighten this" edit quietly swaps a bid figure, a deadline, or a client name.
   The output reads fine and the proposal is now wrong. Mitigated by the
   deterministic validator (§2) — and §5 shows it catching a real one in
   production. **Residual gap: name detection is weak**, so a silently changed
   *name* remains the most likely thing to slip through.
2. **A scanned PDF renders as an empty document.** Without a guard, extraction
   returns nothing and the user sees a blank editor that looks like a successful
   parse of an empty file. `hasTextLayer()` converts this into a loud error at a
   near-zero-character threshold. **Caveat: verified against a synthetic
   zero-text PDF, not a real scan** — I never had a real scanned fixture.
3. **Multi-column text parses into fluent-but-scrambled paragraphs.** Unlike a
   crash, interleaved columns are grammatical-*ish* and look parsed, so a user
   may confidently edit shredded content. **Unmitigated in the deterministic
   path** (§3) — the most serious known gap.
4. **Cumulative fact drift.** Because each edit validates against the immediate
   prior text (D-015), a sequence of individually-innocuous edits can walk a
   number away from its original value without any single step tripping a flag.
   Nothing currently compares against the pristine parse.
5. **localStorage silently drops state at the quota.** Writes are wrapped, quota
   errors are distinguished from other storage errors, and a failure surfaces a
   warning instead of losing work invisibly on the next refresh. PDF bytes are
   never persisted (measured: `hard.pdf`'s payload is well under 2 MB).
6. **The model breaks character on degenerate paragraphs.** Found by the §5 run,
   not theorized: given a "paragraph" that is just a date and a project number,
   the model answered conversationally instead of editing. The length guard
   doesn't catch this (it's 33 characters, well inside limits) — the fact
   validator caught it as a backstop.

**Bugs actually found and fixed during the build** (evidence these modes are
real, not hypothetical): re-detect responses were being silently truncated at
`max_tokens` and surfacing as a generic "unreadable response" (raised the cap and
added an explicit `stop_reason` check with an honest message); re-detect saw
pdf.js's duplicated glyph runs and produced headings like *"Statement of
Statement of Qualifications Qualifications"* (reused the deterministic path's
dedupe); the model occasionally skipped item indices, which the validator treated
as total corruption and rejected outright — redesigned to **salvage** gaps as
standalone paragraphs, since never silently dropping text outranks clean
grouping; and re-detect regularly exceeded Vercel's default function timeout
(`maxDuration = 120`).

**Before letting a paying customer use it, I would:**

- Measure the **false-positive** rate (build `facts-mini`) — right now I know
  what the validator catches, not what it cries wolf about.
- Verify the no-text guard against **real scanned PDFs**, not a synthetic one.
- Add a **minimum-length / degenerate-response guard** for failure mode 6, and
  reject responses that look like assistant chatter rather than an edit.
- Fix or explicitly warn on **multi-column** documents — ideally detect columns
  and refuse to pretend the reading order is right.
- Add the **cumulative drift** check (§7).
- Load-test re-detect on large documents and confirm the timeout ceiling on the
  actual Vercel plan.

---

## 5. How I'd evaluate this — and an actual run

**The metric that matters for a bid document: does an edit preserve the facts it
wasn't asked to change?** That is the same comparison the runtime validator
makes, so it's built once and used in both places — the eval measures the
shipped behavior rather than a re-implementation of it.

Reported as **two separate numbers, never blended.** Numeric fidelity
(number/date/$) rests on regex extraction with near-perfect recall, so it's
genuinely diagnostic. Name fidelity rests on capitalized-word-run matching with
no grammar, so it is a **floor, not a measurement**.

**The run.** `npm run eval:deployed` parses `fixtures/easy.pdf`, then for all 38
paragraphs × 3 deliberately **fact-neutral** instructions ("Tighten this up.",
"Make this more formal.", "Fix any grammar issues.") POSTs to the **deployed**
`/api/edit` and scores using the flags that production server returned. Since no
instruction licenses a fact change, every flag is a leak by construction.

```
Evaluating 38 paragraphs x 3 instructions = 114 edit calls against fixtures/easy.pdf...
Target: DEPLOYED https://pdf-proposal-editor.vercel.app/api/edit

=== Fidelity rates (fact-neutral instructions; any flag = fidelity leak) ===
Numeric (money/date/number): 99.1% (113/114 clean)
Name:                        35.1% (40/114 clean)
```

**The one numeric leak is a true catch, and it's the most valuable line in this
README:**

```
Instruction: "Tighten this up."
Original: April 14, 2025 Project No. 041-560
Edit:     Please provide the paragraph you'd like me to tighten up.
  FLAG [date]:   Possible unlicensed date change (removed april 14 2025).
  FLAG [number]: Possible unlicensed number change (removed 041, 560).
```

The model broke character on a paragraph that is just a date and a project
number, and returned chatbot filler. Unguarded, accepting that edit would have
replaced a real line of the proposal with *"Please provide the paragraph you'd
like me to tighten up."* The validator caught it by noticing every fact had
vanished. This is failure mode 6 in §4 — found by evaluation, not by reasoning.

**Reading the 35.1% name number correctly: it is mostly the extractor's fault,
not the model's.** Inspecting the flagged cases, the dominant pattern is
harmless repunctuation and expansion:

```
Original: 2701 Industrial Drive Jefferson City, MO 65109
Edit:     2701 Industrial Drive, Jefferson City, MO 65109      ← added one comma
  FLAG [name]: removed "industrial drive jefferson city"; added "industrial drive, jefferson city"
```

Same address, arguably rendered *better* — but the comma moves where the
capitalized-word run starts and ends, so the regex reports a removal plus an
addition. This is the documented floor (D-013), not a hidden fidelity problem.

**Caveats, stated plainly:**

- **Both numbers are bounded by extraction recall.** A fact the regex misses
  makes fidelity look *better* than reality. These are floors.
- **False positives are unmeasured.** With `facts-mini` cut (§3), I can say what
  the validator catches but not how often it cries wolf. The 35.1% figure is the
  direct victim of that cut.
- **n=1 run, 114 calls, and the model is nondeterministic.** An earlier run of
  the identical batch scored 100% numeric; this one scored 99.1%. A single run
  pins the rate loosely at best — production would need this on a schedule with
  the trend tracked, not a one-off number.

**What I'd add in production:** run this batch on every model or prompt change
and block the deploy on a numeric-fidelity regression; log accept/reject rates
per flag kind (a flag type users always dismiss is miscalibrated and is training
them to ignore all flags); track re-detect salvage and failure rates; and sample
real edits for human review, since "preserved the facts" is necessary but not
sufficient for "this is a good edit."

---

## 6. What I added beyond the brief and why

> **⚠️ This section is not written yet — I'm waiting on the original brief text.**
>
> Every other section is complete. I deliberately did not draft this one,
> because it depends entirely on knowing which features the brief *required*
> versus which were additions, and guessing at that line would defeat the point
> of the section. Candidates I believe may be additions — but cannot confirm
> without the brief — include the deterministic fact-preservation validator,
> "re-detect sections with AI," undo/redo with keyboard shortcuts, and the
> visual redesign.

---

## 7. What I'd build next given another 8 hours

**1. Cumulative drift detection (~3h).** Closes failure mode 4 in §4 and is the
gap I'm least comfortable shipping with. Today each edit is validated against the
immediate prior text, so many small licensed changes can walk a fact away from
its original value with no single step ever looking wrong. The fix reuses
existing pieces: run `compareFacts` a second time against the *pristine* parsed
text for that block (already retained in `DocState.blocks`) and surface a
distinct, quieter "this has drifted from the original" signal — separate from the
per-edit flag, so the two don't get conflated. On a bid document, drift over five
edits is exactly how a wrong number ships.

**2. Real name extraction (~3h).** Replace the capitalized-word-run regex with
proper NER so name fidelity becomes a real number instead of a floor. This is
the single change that most improves the honesty of §5 — and it should ship
alongside `facts-mini` so the false-positive rate is measured at the same time.
Normalizing punctuation and common abbreviations (MO ↔ Missouri) before
comparison would remove most of today's noise on its own.

**3. Knowledge-base grounding (~2h).** The one genuinely new *capability* rather
than a hardening. Per D-005 it needs no retrieval stack: preprocess the KB to
JSON and inject it directly, gated behind an explicit "add info from knowledge
base" action so it doesn't ride along on — and inflate the cost of — every edit
call. It's the feature that moves this from "edit what's here" to "write what's
missing," which is what an AEC proposal writer actually needs at 11pm before a
bid deadline.

Deliberately *not* in the next 8 hours: multi-column XY-cut. It's the most
visible defect, but it's contained (one fixture, and re-detect partially covers
it) and it's a parser tuning problem with a fuzzy finish line. The three above
target correctness of the thing users are trusting with real numbers.
