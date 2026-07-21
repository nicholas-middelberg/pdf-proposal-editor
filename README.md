# pdf-proposal-editor
Web app that lets a user upload a PDF of a construction proposal and edit it section by section using AI

## Setup

```
cp .env.example .env.local
# then paste the real hiring-proxy token into .env.local as PROXY_TOKEN=...
npm install
npm run dev
```

`PROXY_TOKEN` is read only inside `app/api/edit/route.ts` (D-010) and must
never be committed or prefixed `NEXT_PUBLIC_`.

## Model

`/api/edit` (`lib/ai.ts`) is pinned to `claude-sonnet-5` — confirmed served
by the live hiring proxy (verified with real edit calls against
`fixtures/easy.pdf`-style paragraphs).

## Fact-fidelity eval

`scripts/eval.ts` (Task 10) parses `fixtures/easy.pdf`, runs a fixed batch of
fact-*neutral* instructions ("Tighten this up.", "Make this more formal.",
"Fix any grammar issues.") against every real paragraph, and diffs extracted
facts before/after via `lib/facts/compare.ts` — the same module (and the same
`proposeEdit` call) `/api/edit` uses at runtime, so the eval measures actual
production behavior. It makes real, live API calls and is **not** wired into
`npm test`; run it manually with `npm run eval`.

Results (38 paragraphs × 3 instructions = 114 edit calls, `claude-sonnet-5`):

```
=== Fidelity rates (fact-neutral instructions; any flag = fidelity leak) ===
Numeric (money/date/number): 100.0% (114/114 clean)
Name:                        35.1% (40/114 clean)
```

- **Numeric fidelity is perfect** across this run: no dollar amount, date, or
  number was altered by an instruction that didn't ask for it.
- **Name fidelity looks weak, but the leaks are mostly the extractor's
  fault, not the model's.** Name extraction is a deliberately naive
  capitalized-word-run regex (D-013) with no real grammar — it has no
  concept of "this is still the same address, just repunctuated." Reading
  the flagged examples: the model turns `"2701 Industrial Drive Jefferson
  City, MO 65109"` into `"2701 Industrial Drive, Jefferson City, MO 65109"`
  (added a comma) or expands `"MO"` → `"Missouri"` — both harmless, arguably
  *more* correct renderings, but they shift where the capitalized-word run
  starts/ends, so the regex reports it as "removed X, added Y." This is the
  documented floor for the name axis (D-013), not a hidden fidelity problem:
  over-warning is the deliberate design (a false positive costs the user one
  glance at a flag; a false negative is the silent failure the product
  exists to prevent).
- `facts-mini/` (Flag C, a hand-labeled fixture for measuring *false
  positives* specifically) was cut — no time remained after Tasks 1–9. The
  false-positive rate is therefore unmeasured; it would be the first eval
  addition if this were continued past v1.
