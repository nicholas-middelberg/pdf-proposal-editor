// Non-edit detection: did the model return an EDIT, or a reply?
//
// Observed in a real eval run against the deployed app: given the paragraph
// "April 14, 2025 Project No. 041-560" and the instruction "Tighten this up.",
// the model answered "Please provide the paragraph you'd like me to tighten
// up." — it read a short metadata line as "no paragraph was supplied" and
// broke character. Unguarded, accepting that proposal replaces a real line of
// the proposal with chatbot filler.
//
// Why this needs its own guard rather than leaning on lib/facts/compare.ts:
// the fact validator only noticed because that line happened to be fact-dense
// (it saw every date and number vanish). Chatter returned for a prose
// paragraph carrying no numbers, dates, or names produces NO flags at all and
// reaches the user looking like a legitimate proposed edit.
//
// The distinction being drawn: "the model did the task badly" is the human's
// call (D-012 rung 2 — flag, let the user decide). "The model did not do the
// task" is deterministically wrong, and is rejected server-side like the
// empty-response case it sits beside in app/api/edit/route.ts.

/** Function words carry no evidence that an edit is about the same subject. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'd', 'do',
  'for', 'from', 'had', 'has', 'have', 'he', 'her', 'his', 'i', 'if', 'in',
  'is', 'it', 'its', 'll', 'me', 'my', 'not', 'of', 'on', 'or', 'our', 're',
  's', 'she', 'so', 't', 'that', 'the', 'their', 'them', 'then', 'there',
  'these', 'they', 'this', 'to', 'up', 've', 'was', 'we', 'were', 'will',
  'with', 'would', 'you', 'your',
]);

/**
 * Lowercased alphanumeric runs, minus stopwords, deduped. Splitting on
 * non-alphanumerics means "041-560" contributes "041" and "560" and
 * "April 14, 2025" contributes "april", "14", "2025" — the fact-bearing
 * tokens most likely to survive a legitimate edit.
 */
function contentTokens(text: string): Set<string> {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(matches.filter((t) => !STOPWORDS.has(t)));
}

/** Share of the original's content tokens that survive into the edit. */
function retention(original: string, proposed: string): number {
  const before = contentTokens(original);
  if (before.size === 0) return 1; // nothing to retain; not evidence of anything
  const after = contentTokens(proposed);
  let kept = 0;
  for (const token of before) if (after.has(token)) kept++;
  return kept / before.size;
}

// Phrasing that addresses the user or refuses the task, rather than being the
// edited text. Deliberately NOT used on its own: an AEC proposal legitimately
// contains lines like "Please provide the following documents by June 1", so
// this only fires alongside a collapse in content retention (see below).
const CLARIFICATION_RE =
  /\b(please (?:provide|share|paste|send|supply)|could you (?:please )?(?:provide|share|clarify|paste)|i(?:'m| am) (?:unable|sorry|happy to)|i (?:can(?:no|')?t|don't see|didn't receive|need)|it (?:looks|seems) like (?:you|there)|you (?:haven't|have not|didn't|did not) (?:provide|include|paste|share)|there (?:is|was) no (?:paragraph|text|content)|let me know|happy to help)/i;

/**
 * Rule (a) needs enough of a signal to be meaningful — on a one- or two-word
 * original, zero overlap can happen for innocent reasons.
 */
const MIN_TOKENS_FOR_ZERO_RETENTION_RULE = 4;

/** Below this, an edit has diverged enough that refusal phrasing is damning. */
const LOW_RETENTION = 0.34;

/**
 * Returns a reason string when `proposed` looks like a reply about the task
 * rather than an edit of `original`; null when it looks like a real edit.
 *
 * Fails safe in both directions by design. A false rejection surfaces "the AI
 * returned a reply instead of an edit, try again" and leaves the paragraph
 * untouched — recoverable and honest. A false acceptance puts chatbot text
 * into a construction bid.
 *
 * Known, accepted tradeoff: an instruction that legitimately replaces a
 * paragraph wholesale ("replace this with TBD") produces near-zero retention
 * and is rejected. That is rare, and it fails safe.
 */
export function nonEditReason(original: string, proposed: string): string | null {
  const kept = retention(original, proposed);
  const originalTokenCount = contentTokens(original).size;

  if (kept === 0 && originalTokenCount >= MIN_TOKENS_FOR_ZERO_RETENTION_RULE) {
    return 'the response shares no content with the paragraph it was asked to edit';
  }

  if (kept < LOW_RETENTION && CLARIFICATION_RE.test(proposed)) {
    return 'the response reads as a reply to the user rather than an edited paragraph';
  }

  return null;
}
