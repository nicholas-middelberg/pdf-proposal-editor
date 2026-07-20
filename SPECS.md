# SPECS: AI proposal editor

## Overview
Web app for AEC proposal writing. A user uploads a construction proposal
PDF, the app parses it into editable paragraphs, and the user selects any
paragraph and asks AI to change it (rewrite, tighten, fix names, adjust
tone). Edits are proposed as a diff, accepted or rejected by the user, and
compose into the working document.

Time budget: 1-2 days. Deployment is a requirement, not a nice-to-have.

## Goals
- Upload a proposal PDF, get back structured, editable paragraphs.
- Select a paragraph, give a freeform instruction, receive a proposed edit.
- Review as a diff; accept or reject.
- Accepted edits apply to the document and compose with prior edits.
- Undo via tracked change history.
- Export the edited document as markdown / plain text.
- Runs on a deployed URL.

## Non-goals (deliberate, see DECISIONS.md)
- **Layout fidelity.** Original PDF formatting, tables, letterheads, and
  pricing schedules are discarded. Export is markdown/text only.
- **Scanned PDFs / OCR.** No text layer = clear error message, not support.
- **Knowledge base grounding.** Stretch goal only (see below).
- **Multi-column / complex layout parsing.** Deferred to stretch. v1 reads
  in document order, so the hard fixture's columns interleave; the `bbox`
  data needed to fix it is captured, making the fix reachable (D-004).
- Auth, multi-user, collaboration, versioned server-side documents.

## Requirements

### Functional
1. Upload a PDF; reject non-PDF and no-text-layer files with a clear error.
2. Parse into ordered blocks (`heading` | `paragraph`), preserving
   positional data even though the prototype does not use it.
3. Render blocks in document order. Headings are **navigation only** — they
   group paragraphs visually. The editable unit is the paragraph.
4. "Re-detect sections with AI" button — user-triggered reparse via LLM,
   returning block boundaries as JSON. Sends the **positioned items**
   (`{text, x, y}`), not flat text (D-003). **Available only before the first
   edit; disabled once editing begins (D-016).**
5. Select a paragraph → enter freeform instruction → call AI → show diff.
6. Accept applies the change; reject discards it. Both are recorded.
7. Change history panel with undo.
8. Export current document state as markdown.

### Non-functional
- State survives a page refresh (localStorage; no database).
- AI call failures surface as an inline error on the paragraph, not a crash.
- Deployed and reachable at a public URL.
- The proxy token is never exposed to the client. All AI calls originate
  from server-side API routes.

## Stack

| Layer | Choice | Why | See |
|---|---|---|---|
| Framework | Next.js + TypeScript | One deploy; single `/api/edit` route holds the token | D-007 |
| Hosting | Vercel | Makes the "deployed app" requirement near-free | D-007 |
| PDF extraction | unpdf | Keeps x/y coords; pdf-parse discards them | D-004 |
| Where it parses | Client-side, Web Worker | No upload → Vercel's 4.5MB body limit never applies | D-011 |
| AI | Anthropic SDK via hiring proxy | Brief mandates the proxy; token is server-side only | D-010 |
| State | React state + localStorage | Survives refresh, zero backend | D-006 |
| Tests | Vitest, parser only | Parser is pure functions; fixtures are free test data | D-009 |

## AI provider / API

The brief supplies an AI proxy — a drop-in replacement for the official
APIs. Use the official SDK and override `baseURL`. Models, request shapes,
and streaming behave exactly as the official SDKs document.

- **Base URL:** `https://hiring-proxy.trybuoyant.ai`
- **Anthropic:** `https://hiring-proxy.trybuoyant.ai/anthropic`
- **OpenAI:** `https://hiring-proxy.trybuoyant.ai/openai`
- **Auth:** one token, both providers, supplied separately. Pass as
  `apiKey`.

```ts
// lib/ai.ts — server-side only
import Anthropic from '@anthropic-ai/sdk'

export const anthropic = new Anthropic({
  apiKey: process.env.PROXY_TOKEN,          // NEVER NEXT_PUBLIC_*
  baseURL: 'https://hiring-proxy.trybuoyant.ai/anthropic',
})
```

**Token safety (non-negotiable):** the token is a hiring credential valid
for both providers. It lives in `.env.local`, is read only inside
`/app/api/*` route handlers, and must never be prefixed `NEXT_PUBLIC_` or
imported into a client component. `.env.local` stays gitignored; document
the required var in `.env.example`.

**Spend is metered.** The proxy meters token usage, so treat context size as
a cost, not just a latency concern:
- Edit calls send **one paragraph**, not the whole document.
- "Re-detect with AI" is user-triggered and infrequent by design (D-003),
  which is part of why that decision holds up on cost. Note it sends
  **positioned items, not flat text** — see D-003's correction; flat text is
  already shredded on multi-column pages.
- If the KB stretch goal lands, do not attach the KB to every edit call.
  Gate it behind an explicit "add info from knowledge base" action (D-005).

Pin the exact model string at build time and record it here — do not leave
it to a floating alias.

## Architecture & key files

```
/app
  /api/edit/route.ts    - EditRequest -> EditProposal
                          ONLY server route. Holds the token. (D-010)
  page.tsx              - editor view
/lib/pdf
  extract.ts            - unpdf -> positioned text items
  segment.ts            - items -> Block[]  (PURE, unit tested)
  parse.worker.ts       - runs extract + segment off the main thread
/lib
  store.ts              - document state, history, localStorage
/lib/facts
  extract.ts            - regex fact extraction (number/date/$/name)
  compare.ts            - original vs edit -> flags. Used by BOTH the
                          runtime validator and the eval script (D-013)
/components
  DocumentView.tsx  ParagraphBlock.tsx  DiffView.tsx  HistoryPanel.tsx
/scripts
  eval.ts               - batch-run edits, print fidelity rates + examples
/fixtures
  easy.pdf  hard.pdf  facts-mini/   (hand-built known-fact paragraphs)
```

There is no `/api/parse`. The PDF is read by the browser via the File API
and parsed in a Web Worker; it never crosses the wire (D-011).

### Key interfaces
```ts
type Block = {
  id: string          // content-derived (hash of text + page), NOT positional.
                      // Stable across re-detect so history survives. (D-015)
  type: 'heading' | 'paragraph'
  text: string
  page: number
  bbox: [number, number, number, number]   // kept for the multi-column stretch
}

type ParseResult   = { blocks: Block[]; method: 'deterministic' | 'ai' }
type EditRequest   = { blockId: string; text: string; instruction: string }
type EditProposal  = { blockId: string; original: string; proposed: string }
                     // "original" = immediate prior text, the validation
                     // baseline — not the pristine parse. (D-015)
type HistoryEntry  = { blockId: string; from: string; to: string
                       instruction: string; at: number }
```

### Parsing heuristics (deterministic path)
Font-size jumps, numbering patterns (`1.`, `1.1`, `SECTION 2`), all-caps
lines, and vertical whitespace gaps. Read items in order; **ignore x-position
in v1** (this is what breaks on multi-column — accepted).

## Edge cases
- Non-PDF upload → rejected with message.
- PDF with no text layer (near-zero chars across pages) → clear error.
- Multi-column PDF → text will interleave (hard fixture). Known and
  accepted for v1; the `bbox` data needed to fix it is captured (D-004).
- AI returns malformed/empty edit → inline error, paragraph unchanged.
- Empty or very long paragraph → guard before sending to API.

### Silent-failure risks
The edge cases above fail *loudly* — an error, a rejection, an unchanged
paragraph. These fail *quietly*: the app produces a plausible-looking wrong
result and nothing signals it. This is what to check before a paying customer
touches it, worst first.

1. **AI alters a fact it wasn't asked to change** (headline risk). A "tighten
   this" edit silently swaps a bid figure, a client name, a deadline, a
   dollar amount. Output reads fine; the proposal is now wrong. This is the
   risk the whole edit path is designed around: the D-013 validator flags
   number/date/$/name changes the instruction didn't license, and the D-012
   rung-2 design surfaces them to the user rather than auto-patching. Residual
   gap: name detection is weak (D-013), so a silently changed *name* is the
   most likely one to slip through — documented, not solved, in v1.
2. **Scanned / no-text PDF renders as an empty document.** Without the
   near-zero-character check (D-008), extraction returns nothing and the app
   shows a blank editor that looks like a successful parse of an empty file
   rather than a failure. The guard converts this into the loud error in the
   edge-case list. Check the guard actually fires on the specific fixture.
3. **Multi-column text parses into fluent-but-scrambled paragraphs.** Unlike
   a crash, interleaved column text is grammatical-ish and *looks* parsed —
   the user may edit shredded content without realizing the reading order is
   wrong. Accepted for v1 (hard fixture), but it is a silent failure, not a
   visible one, so it belongs on this list.
4. **localStorage silently drops state at the quota.** If the persisted blob
   ever approaches the ~5-10 MB cap (e.g. the raw PDF got serialized in by
   mistake — see D-006), a write can fail and the user loses work on refresh
   with no warning. Guard: wrap writes, surface a warning on failure, and
   never persist the file bytes.

**Before a paying customer:** verify (1) the fact-flag fires on a real
fact-changing edit and its false-negative rate on numbers/dates/$ is near
zero; (2) the no-text guard fires on the actual scanned fixture; (3) a
quota-exceeded write warns rather than failing silently.

## Stretch goals
1. **Knowledge base grounding.** Preprocess the example KB to JSON, inject
   into the prompt directly. No RAG, no retrieval — it fits in context.
2. **Multi-column reading order.** XY-cut over the `bbox` data already being
   captured: project item x-ranges, find the vertical gutter, split
   left/right, sort each side by y. Target: hard fixture.
   **Not tables** — those are already out of scope via D-001/D-002 and are
   not part of this stretch goal (see D-004).
3. Server-side persistence (Vercel Blob for the PDF + a DB row for state).

## Evaluation plan

The metric answers the question that matters for a construction bid: **does
an edit preserve the facts it wasn't asked to change?** This is the same
comparison the runtime flag uses (D-012/D-013) — built once, used at runtime
to warn the user and offline to produce a number.

**What's measured — fidelity, reported split (D-013):**
- **Number / date / $ fidelity:** of edits where the instruction did not
  license a change to a figure, the share that left every number, date, and
  dollar amount intact. Regex extraction here has near-perfect recall, so
  this slice is genuinely diagnostic.
- **Name fidelity:** same, for proper names. Regex name detection is the weak
  axis, so this slice is a **floor, not gospel** — reported separately and
  never blended into the number slice.

**What it runs against — two sets:**
1. **Live, easy fixture (primary).** Parse `easy.pdf`, run a fixed batch of
   edit instructions that should NOT touch facts ("tighten this", "make it
   more formal", "fix grammar"), diff extracted facts in vs. out, tally.
2. **Hand-built mini set (secondary, if time).** ~10 short paragraphs with
   *known* embedded facts and paired instructions — some fact-neutral, a few
   that legitimately license a change. This is the only way to measure false
   positives (flagging a licensed change) as well as false negatives, since
   the fixture alone has no ground-truth "licensed" labels.

**What goes in the README:**
- Both fidelity numbers (number/date/$ and name), each as a percentage over
  a stated N.
- **Worked examples:** at least one true catch (edit silently changed a
  figure → flagged) and, from the mini set, one licensed change and how it
  was handled. Real strings, not just rates.
- The caveat, stated plainly: the number is bounded by extraction recall — a
  missed fact makes fidelity look better than reality — so it's a floor. Name
  fidelity especially.

**Instrumentation this requires (plan for it now, not at 11pm):**
- The edit path logs `{original, instruction, edit}` triples so a batch can be
  replayed and scored offline.
- Fact extraction + comparison lives in one module callable from both the
  runtime validator and the eval script (`lib/facts/` or similar).
- A tiny eval script (`scripts/eval.ts`) that runs a batch and prints the two
  rates + examples. Not wired into `npm test` (it makes live AI calls); run
  manually, paste output into the README.

## Definition of done
Run against the **easy fixture on the deployed app**:
- [ ] Upload easy.pdf → parses into sensible headings + paragraphs.
- [ ] Select a paragraph, give an instruction, receive a proposed edit.
- [ ] Diff renders; accept applies it; reject discards it.
- [ ] A second edit on the same paragraph composes on top of the first.
- [ ] Undo reverts the last accepted edit.
- [ ] Refresh the page → document and history are still there.
- [ ] Upload a scanned/no-text PDF → clear error, no crash.
- [ ] Export produces markdown reflecting all accepted edits.
- [ ] `npm test` — parser unit tests pass against easy.pdf.
- [ ] Proxy token does not appear in the client bundle
      (`grep -r "$PROXY_TOKEN" .next/static` returns nothing).
- [ ] `scripts/eval.ts` runs against the easy fixture and prints both
      fidelity rates + examples; output pasted into the README.
