# Decisions log

ADR-style. One entry per decision where a reasonable person could have gone
the other way. Referenced from SPECS.md.

**Statuses:** `Proposed` → `Accepted` / `Rejected` → `Superseded by D-0XX`

---

### D-001: Export markdown/text; discard layout fidelity
- **Status:** Accepted
- **Context:** 1-2 day budget. Construction proposals are heavily formatted
  — tables, pricing schedules, letterheads. Round-tripping a PDF with
  layout intact is a large project on its own.
- **Options:** (a) export PDF matching original; (b) export .docx;
  (c) export markdown/plain text.
- **Decision:** Markdown/plain text.
- **Rationale:** Removes an entire subsystem (layout reconstruction) for the
  cost of one honest limitation. Everything downstream gets simpler.
- **Tradeoff:** An AEC reviewer *will* notice the formatting is gone. This
  is only defensible as a stated non-goal — hence this entry.

### D-002: Paragraph is the editable unit; headings are navigation
- **Status:** Accepted
- **Context:** The brief says "edit section by section," which is ambiguous
  between headings-as-sections and paragraphs.
- **Decision:** Paragraphs are editable. Headings group them visually only.
- **Rationale:** One granularity means one selection model, one diff model,
  one history model. Two would mean competing state.
- **Tradeoff:** No "rewrite this whole section" action in v1.

### D-003: User-triggered AI reparse, not automatic confidence escalation
- **Status:** Accepted
- **Context:** Wanted a deterministic parser that escalates to AI when the
  PDF doesn't parse cleanly.
- **Options:** (a) auto-escalate on a confidence heuristic; (b) AI-only
  parsing; (c) deterministic + a manual "re-detect with AI" button.
- **Decision:** (c).
- **Rationale:** The AI path is cheap (~1hr: dump text, get JSON boundaries).
  The expensive part is *defining "didn't parse cleanly"* — that's a tuning
  problem with no clear finish line. A button converts an invisible
  threshold problem into a visible user action. Both paths ship; the
  reviewer sees both; the tuning is skipped.
- **Tradeoff:** Not automatic. Acceptable — arguably better UX anyway.
- **Correction — what the button sends:** it must NOT send flat text. On a
  multi-column page the text is already interleaved before the model sees
  it; asking an LLM to unshred it is asking it to guess. Send one of:
  1. the positioned items as JSON (`{text, x, y}`) → ask for reading order;
  2. a rendered page image → vision model.
  (1) is cheaper and enough for column ordering. (2) is more robust if
  tables ever come into scope (they don't — see D-004). Both providers on
  the token support vision (D-010), so (2) is available without new deps.
  For the easy fixture, flat text is fine; the distinction only bites on
  the stretch goal.

### D-004: unpdf for extraction — keep positional data from day one
- **Status:** Accepted (supersedes the earlier "pdf.js" phrasing)
- **Context:** Hard fixture is multi-column. PDFs don't store text in
  reading order — they store drawing instructions, and reading order isn't
  defined in the ISO PDF standard at all. Naive extraction reads across the
  full page width, interleaving columns into unusable text. x-position is
  the *only* signal that columns exist. Deferred as a stretch goal — but
  the library choice is load-bearing and irreversible.
- **Options:**
  - (a) `pdf-parse` — flat string. Concatenates items with spaces; jumbled
    output on multi-column. Coordinates permanently discarded.
  - (b) `pdfjs-dist` — item array with transform matrices. Works, but
    fiddly to package (canvas dep, worker config).
  - (c) `unpdf` — UnJS wrapper over pdf.js. Same underlying item array,
    ergonomic API, runs in browser / Node / edge.
  - (d) `@opendataloader/pdf` — XY-Cut++ reading order, per-element bboxes,
    heading/paragraph/table detection, Apache 2.0. **Rejected: requires
    Java.** Each conversion spawns a JVM process; there is no JVM on Vercel
    serverless. The tool that best solves the stretch goal is
    architecturally incompatible with D-007.
- **Decision:** (c) `unpdf`. Keep `bbox` on every Block. v1 ignores it.
- **Rationale:** **Highest-leverage decision here.** A flat-text library
  discards x-coordinates permanently, making column detection impossible to
  add later without re-architecting the parse path. unpdf costs nothing
  extra today and keeps the stretch goal a feature rather than a rewrite.
  Chosen over raw pdfjs-dist purely for ergonomics and packaging.
- **Scope correction — the stretch goal is smaller than it looked.** The
  hard fixture has multi-column *and tables*, but tables are already out of
  scope by two prior decisions: D-001 exports markdown, D-002 makes the
  paragraph the editable unit. There is no table block in `Block`, no table
  editing affordance, no table export. Adding tables isn't a stretch goal,
  it's a different product. **The real stretch goal is reading order only.**
- **Consequence:** reading order = XY-cut, the classic algorithm (and what
  OpenDataLoader's XY-Cut++ refines). On a two-column page: project each
  item's x-range onto the x-axis, find the vertical gutter (a sustained
  x-gap with no glyphs across most of the page height), split items
  left/right, sort each side by y, concatenate. An afternoon's work on data
  already captured. Not a document-understanding engine — one white stripe.
- **Tradeoff:** Slightly more setup than pdf-parse. Trivial. Rejecting (d)
  means no free table/heading detection, which D-002 makes moot anyway.

### D-005: Knowledge base cut to stretch; no RAG when it lands
- **Status:** Accepted
- **Context:** "Add information from a knowledge base" was raised alongside
  "rewrite" and "fix tone" — but it's a second product (ingest, chunk,
  embed, retrieve), not a prompt variant. It would consume the budget.
- **Decision:** Cut from v1. When built: preprocess the example KB to JSON
  and inject it into the prompt directly.
- **Rationale:** If the KB fits in a context window, retrieval solves a
  problem we don't have. This makes the stretch goal genuinely reachable.
- **Tradeoff:** Only valid while the KB is small (boilerplate, past project
  facts, standard terms). If it grows to hundreds of pages, revisit — this
  decision would be superseded by a real retrieval design.
- **Amendment (see D-010):** the proxy meters spend, so the KB must not ride
  along on every edit call. Gate it behind an explicit "add info from
  knowledge base" action so the cost is paid only when the user asks for it.
  This is a second, independent reason retrieval isn't needed: we control
  *when* the KB enters context, not just whether it fits.

### D-006: Client-side state in localStorage; no database
- **Status:** Accepted
- **Context:** Needed the simplest thing that survives a refresh.
- **Options:** (a) in-memory only; (b) localStorage; (c) DB; (d) blob store.
- **Decision:** localStorage.
- **Rationale:** Blob storage holds *the PDF*; the thing that must survive a
  refresh is *structured state* (blocks, history, accept/reject) — that's a
  DB row, not a blob. localStorage gets refresh-durability for ~10 lines and
  zero backend. A reviewer will refresh mid-demo; losing their work is a
  bad look for near-zero cost to prevent.
- **Tradeoff:** Single browser, single user, no sharing. All non-goals.
- **What gets persisted (important — don't blow the quota):** localStorage
  holds only the *parsed* state — `Block[]` (extracted text + bbox) and edit
  history. This is plain text/numbers, typically well under 1 MB even for a
  long proposal.
  - **Do NOT persist the raw PDF bytes.** A file's on-disk size is dominated
    by fonts and images, which are discarded at parse time and never reach
    localStorage. A 13 MB PDF base64-encodes to ~17 MB and instantly blows
    the ~5-10 MB per-origin quota. The parsed text from that same file is a
    few hundred KB. Persist blocks, not the file.
  - The only figure that counts against the quota is how much *text* the
    proposal contains, not the file size.
  - If "re-detect with AI" should work after a refresh (D-003), persist the
    positioned items too — that roughly doubles the stored text, still
    comfortably under quota. Verify against the real hard-fixture number
    rather than assuming.

### D-007: Next.js + TypeScript on Vercel
- **Status:** Accepted
- **Context:** "Deployed app" is an explicit brief requirement and eats real
  hours from a 1-2 day budget.
- **Decision:** Next.js full-stack, deployed to Vercel.
- **Rationale:** Chosen substantially *because* it makes deployment nearly
  free. A single `/api/edit` route holds the token and calls the LLM; parsing
  is client-side (D-011), so no separate service is needed. One language
  across the stack.
- **Tradeoff:** None significant post-D-011. (Earlier concern about pdf.js in
  a serverless route is moot — parsing moved to the browser.)

### D-008: Scanned PDFs detected and rejected, not OCR'd
- **Status:** Accepted
- **Context:** Scanned documents are common in AEC. OCR is a real subsystem.
- **Decision:** Detect (near-zero extracted chars across pages) → clear
  error. No OCR.
- **Rationale:** Detection is a few lines and is the difference between a
  clear message and the app silently rendering an empty document, which
  reads as a crash. OCR doesn't fit the budget.
- **Tradeoff:** Genuinely unsupported input class. Stated as a non-goal.

### D-009: Parser unit tests only
- **Status:** Accepted
- **Context:** DoD is a manual end-to-end demo on the deployed app.
- **Decision:** Unit test `lib/pdf/segment.ts` against the fixtures. No UI
  or LLM tests.
- **Rationale:** The parser is the only component with logic worth asserting
  on, and it's pure functions. The brief's fixtures are free test data.
  Mocking an LLM to assert it returns a string proves nothing.
- **Tradeoff:** No regression safety on the diff/accept/history state
  machine — which is where the real bugs will live. Accepted for budget;
  first thing to add with more time.

### D-010: Anthropic via the supplied hiring proxy; OpenAI available but unused
- **Status:** Accepted
- **Context:** The brief supplies a proxy (`hiring-proxy.trybuoyant.ai`) that
  is a drop-in replacement for the official APIs, with a **single token
  valid for both OpenAI and Anthropic**. Provider choice is therefore open
  and free — no extra signup, no second key. It "adds nothing and removes
  nothing — it just authenticates you and meters spend."
- **Options:** (a) Anthropic SDK via `/anthropic`; (b) OpenAI SDK via
  `/openai`; (c) both, routed per task.
- **Decision:** (a). Anthropic SDK, `baseURL` pointed at the proxy.
- **Rationale:** Both providers are equally capable for this workload
  (rewrite a paragraph; return section boundaries as JSON) and neither has
  a decisive edge worth spending time evaluating in a 1-2 day budget. One
  SDK means one client, one error-handling path, one retry policy. (c) is
  strictly worse here — two SDKs for no functional gain.
- **Tradeoff:** No provider comparison to show the reviewer. Acceptable —
  the brief tests product judgment, not a model bake-off. Switching is a
  one-line `baseURL` + SDK swap if it ever matters, which is precisely why
  this decision is cheap to make and cheap to reverse.
- **Consequences:**
  - The token is a **hiring credential for both providers** — server-side
    only, never `NEXT_PUBLIC_*`, never in a client component. D-007
    (Next.js API routes) makes this the default rather than a discipline
    problem.
  - **Spend is metered.** Context size is a cost, not just latency. Send one
    paragraph per edit call, not the document. See the amendment on D-005.
  - **Streaming: not in v1** (fast-follow). The proxy supports it with no
    architectural change, but the D-013 fact-validator runs on the *complete*
    edit text — you can't tell if a number changed until you have the whole
    number. So the accept/reject diff *with fact-flags* can't render until the
    stream finishes regardless. Streaming would buy "watch it type," not "act
    on it sooner," at the cost of streaming-response handling + partial-text
    UI state — the wrong spend in a 1-2 day budget. v1 uses a plain "editing…"
    state. Revisit only if real edit latency hits ~6-8s, where a spinner stops
    being acceptable. **If adopted later:** the validator still gates the diff
    — stream for feel, but keep accept/reject disabled until the full text has
    passed validation.
  - Pin the exact model string; don't rely on a floating alias.

### D-011: Parse client-side in a worker; no upload route
- **Status:** Accepted
- **Context:** Vercel Functions cap **request and response bodies at 4.5 MB**
  (413 `FUNCTION_PAYLOAD_TOO_LARGE`). The hard fixture is double-length; a
  construction proposal with a logo and site photos clears 4.5 MB without
  trying. A server-side upload route works on localhost and 413s in
  production — the worst possible failure timing.
- **Note:** independent of D-004. `unpdf` runs in browser, Node, and edge;
  the library choice does not force this and this does not force it.
- **Options:** (a) upload → `/api/parse` → serverless pdf parse; (b) (a) plus
  client-uploads to Vercel Blob with signed URLs to dodge the limit;
  (c) parse in the browser, in a Web Worker.
- **Decision:** (c).
- **Rationale:** The file never crosses the wire, so the 4.5 MB limit never
  applies — the problem is removed rather than worked around. (b) solves it
  by adding a storage dependency, signed URLs, and a second failure mode, to
  transmit a file the server doesn't need. Also avoids pdf.js serverless
  packaging pain (canvas dep, worker config), and is coherent with D-006 —
  state already lives client-side. The API surface collapses to a single
  route whose only job is holding the token and calling the LLM (D-010).
- **Consequences:**
  - `/api/parse` does not exist. `/api/edit` is the only server route.
  - Parsing runs off the main thread (Web Worker) so a long document doesn't
    freeze the UI.
  - **Closes the door on JVM/native parsers permanently** (D-004 (d)). Judged
    acceptable because the real stretch goal is reading order, not tables.
  - Parser unit tests are unaffected: `segment.ts` is pure functions over
    positioned items and runs under vitest in Node regardless of where
    production parses (D-009).
- **Tradeoff:** Parse cost lands on the user's machine, and no server-side
  caching of parse results. Both irrelevant at this scope.

### D-012: Edit mechanism — single call + deterministic flag (rung 2)
- **Status:** Accepted
- **Context:** "AI edits the section" hides an architecture fork. The edit can
  be (1) a single completion, (2) a single completion plus a validation pass,
  or (3) a multi-step agent that self-corrects. The brief rewards **product
  judgment**, and the headline failure mode (D-014) is a *silent* one — a
  name/number/date/$ silently altered in a construction bid.
- **Options:**
  - **Rung 1 — single call, prompt only.** Paragraph + instruction in, edit
    out, diff. No guard against fact drift beyond the prompt.
  - **Rung 2 — single call + deterministic validation that FLAGS.** Same call,
    then a deterministic check compares facts in original vs. edit; if
    something changed that the instruction didn't license, surface it to the
    user (highlight + warning). Human is the backstop. No second AI call.
  - **Rung 3 — single call + validation that AUTO-CORRECTS.** Same detection,
    but on mismatch fire a second AI call to redo. More autonomous; doubles
    latency on the unhappy path; the retry can also fail or oscillate; and it
    *hides* the problem instead of showing it.
- **Decision:** Rung 2.
- **Rationale:** For construction bids the human must stay in the loop — the
  right move on a detected fact change is to make it *loud*, not to silently
  patch it. Rung 3 optimises for autonomy the brief isn't asking for and runs
  opposite to the "keep the reviewer in control" instinct. Rung 2 is also
  trivially measurable: the same comparison that flags at runtime *is* the
  eval metric offline (D-013, Req 5) — build once, use twice.
- **Agent shape (concrete):**
  - **One completion per edit.** Input: the selected paragraph text + the
    user's freeform instruction. No document-wide context, no KB (D-005 keeps
    the KB out of the edit path entirely in v1).
  - **System prompt** fixes the role (proposal editor), forbids changing
    facts unless explicitly instructed, and asks for the revised paragraph
    only — no preamble, so the diff is clean.
  - **Post-edit validation** (D-013) runs deterministically on the returned
    text before it's shown as an accepted-able diff.
- **Consequences:**
  - `/api/edit` does one model call, then hands the result to the validator
    before returning. Validator is pure/deterministic and can run
    client-side or in the route.
  - Latency is one call — no unhappy-path doubling.
  - Rung 3 is a clean future step if ever wanted: detection already exists,
    only the on-mismatch action changes.
- **Tradeoff:** Not "agentic" in the multi-step sense. Deliberate — see
  rationale. If a reviewer specifically wanted a self-correction loop, that's
  the one argument for rung 3, judged to lose to product-judgment framing.

### D-013: Fact-preservation check — regex extract, flag generously, split reporting
- **Status:** Accepted
- **Context:** D-012 rung 2 needs a deterministic validator that compares
  facts in the original paragraph against the AI edit and flags unlicensed
  changes. This is the guardrail against the headline silent failure (D-014)
  and doubles as the eval metric (Req 5). Four fact categories matter for a
  construction bid: **names, numbers, dates, dollar figures.**
- **Extraction options:**
  - (a) regex / deterministic only;
  - (b) regex + a lightweight in-process NER lib (e.g. compromise) for names;
  - (c) a second AI call to extract entities as JSON.
- **Decision:** (a) regex. Note (c) as the fallback if name recall proves
  inadequate on a real run.
- **Rationale — the split is the whole point:**
  - **Numbers, dates, $ have shapes** (`$1,250,000`, `15%`, `Jan 15 2026`).
    Regex extracts them with near-perfect recall, zero dependency, instant,
    and — crucial for a take-home — *inspectable*: a reviewer reads the
    pattern and sees exactly what it catches. Three of four categories are
    fully covered.
  - **Names have no shape** ("Acme Corp", "City of Oakland", "Jane Ruiz,
    P.E."). Regex here is just capitalized-word runs: noisy, over-catches
    ("Structural Steel"), under-catches lowercase edges. This is the weak
    axis, accepted rather than engineered around.
  - Why cheap-and-noisy is OK here: the rung-2 philosophy is **flag
    generously, let the user dismiss** (below). A false positive costs a
    glance; a false negative is the silent failure we're killing. That
    asymmetry rescues regex — we don't need NER's precision because the
    product already absorbs false positives. NER (b) adds a dependency and
    its own domain misses; AI extraction (c) can hallucinate an entity that
    wasn't there, corrupting the metric.
- **Flag logic — "unlicensed" not "any change":** legitimate edits *do* touch
  these fields ("fix the client name to Acme Corp" is a requested name
  change). So the rule is not "entity changed → warn"; it's "entity changed
  that the *instruction didn't license*." Doing that perfectly is hard, so
  the deliberate call is **over-warn**: flag generously, let the user dismiss.
  Asymmetric costs justify it.
- **Consequences:**
  - The runtime flag and the offline eval share one code path (D-012).
  - **Report split, never blended:** number/date/$ fidelity and name fidelity
    are reported as separate figures (see eval plan). The first slice is
    genuinely diagnostic; the name slice is a floor. Blending them into one
    number would hide a rock-solid measurement inside a shaky one.
  - The metric is bounded by extraction recall — a missed figure makes
    fidelity look *better* than reality. So the reported number is a **floor,
    not gospel**; state this in the README.
  - Fallback path is pre-decided: if name recall is so poor the name slice is
    meaningless, swap name extraction to an LLM call (option c). Numbers/
    dates/$ stay on regex regardless.
- **Tradeoff:** Name detection is knowingly weak. Made visible (split
  reporting + documented limitation) rather than hidden — which is itself the
  product-judgment signal the brief rewards.

### D-014: Fact alteration is the headline silent-failure risk
- **Status:** Accepted (framing decision — anchors D-012/D-013)
- **Context:** Req 4 asks what could break silently and what to check before a
  paying customer. Many failure modes are *loud* (rejections, errors, blank
  states). One is quiet and expensive: the AI editor changing a name, number,
  date, or dollar figure it wasn't asked to touch, producing fluent output
  that is now factually wrong. In a construction bid that's a real-money
  error, not a cosmetic one.
- **Decision:** Treat fact alteration as the primary risk the product is
  designed against, above prose quality or feature breadth. It drives the
  rung-2 edit design (D-012) and the fact-preservation validator (D-013), and
  it is the metric reported in the eval (Req 5).
- **Rationale:** The brief rewards product judgment. Recognizing that the
  danger is a corrupted proposal — not weak writing — and building the edit
  path, the guardrail, and the eval all around that single risk is the
  clearest signal of judgment available. The full ranked list of silent
  failures and the pre-customer checks live in SPECS.md → "Silent-failure
  risks" (kept there to sit beside the edge cases, not duplicated here).
- **Consequence:** name changes are the residual exposure — regex name recall
  is weak (D-013), so a silently altered name is the likeliest to slip the
  net. Stated as a known limitation with a pre-decided fallback (LLM
  extraction) rather than left implicit.

### D-015: Edit-state model — per-step baseline, content-derived stable ids
- **Status:** Accepted
- **Context:** The edit/compose/undo/history machine is the least-specified
  and (per D-009) least-tested part of the app, and it's where the real bugs
  live. Two questions must be answered before building the validator or the
  history, because guessing wrong is a silent bug generator: (1) the
  fact-validator compares an edit against *what* baseline; (2) what happens to
  `blockId`-keyed history when "re-detect with AI" re-parses.
- **Decision 1 — validate against the immediate prior text.** Each edit is
  checked for unlicensed fact changes against whatever the paragraph said
  right before *this* edit, not against the pristine parse.
  - **Consequence — drift accumulates silently across edits.** If edit 1
    changes a figure and the user dismisses the flag, edit 2 treats the new
    figure as baseline and won't re-flag it. The guarantee is "every *single
    step* was checked," not "final text matches the original." This matches an
    accept/reject-per-edit UX and is the honest granularity for it.
  - **Known limitation to state in the README:** no cumulative
    original-vs-final fact check in v1. Cheap future mitigation: show an
    original-vs-current diff at export time. Not required for v1.
- **Decision 2 — ids are content-derived and stable; history survives
  re-detect.**
  - "Stable" specifically means **NOT positional.** Array indices break the
    moment a re-detect merges or splits paragraphs — every later index shifts
    and history silently re-points at the wrong block. Derive the id from
    content (e.g. hash of the paragraph text, or first N chars + page number).
  - **Collision edge:** identical text (repeated boilerplate) hash-collides.
    Accept it, but disambiguate (append an occurrence index) so two identical
    lines don't share one id. The developer must handle this — "stable id" is
    not "don't regenerate ids," it's "derive from content + break ties."
  - Result: re-detect can re-segment the document without orphaning undo.
  - **Amendment (D-016):** this survival guarantee is retired. Re-detect is now
    gated to before the first edit, so there is never history to orphan. Ids
    stay content-derived as the keying contract, but no longer *for* re-detect
    survival.
- **Build-order note:** build this state machine FIRST (D-009 leaves it
  untested, budget spent here is best spent early), and pin both answers
  before writing the validator (D-013) — the validator's baseline depends on
  Decision 1.

### D-016: Re-detect is pre-edit only; history-survival requirement retired
- **Status:** Accepted (narrows D-015 Decision 2)
- **Context:** D-015 Decision 2 made ids content-derived so history could
  survive a re-detect that merges/splits paragraphs. But deciding what happens
  to `blockId`-keyed history when a re-detect splits or merges a block (new
  text → new id → orphaned history) is a real fork with only fragile options
  (drop the history vs. migrate it via a text-overlap heuristic). This is the
  least-tested corner of the least-tested subsystem (D-009/D-015).
- **Decision:** Gate "Re-detect with AI" to *before the first edit*. The button
  is enabled only while history is empty; it is disabled (with a tooltip) once
  the first edit is accepted.
- **Rationale:** Re-detect is naturally a "fix the segmentation before I start
  working" action. With zero history at re-detect time, the merge/split
  orphaning problem cannot arise — the hardest corner is *removed*, not solved.
  Re-detect is not in the SPECS Definition of done, so gating it costs no
  committed scope.
- **Consequences:**
  - `blockId` stays content-derived (still the keying contract), but the
    "survives re-detect" justification for it is retired.
  - D-015 Decision 2's guarantee narrows: history need not survive re-detect,
    because re-detect cannot run once history exists.
- **Tradeoff:** No mid-flight re-segmentation. Acceptable — arguably clearer
  UX, and reversible later (re-introduce post-edit re-detect plus a migration
  policy) with no data-structure change, since ids are already content-derived.
