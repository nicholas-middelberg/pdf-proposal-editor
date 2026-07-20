// Fact-preservation comparison (D-013). Compares facts in the baseline text
// against the AI edit and flags changes the instruction did NOT license.
//
// Baseline = the IMMEDIATE PRIOR text, not the pristine parse (D-015). The
// caller passes it in (see lib/store.ts `baselineText`).
//
// "Unlicensed" is NOT a bare diff (D-013): legitimate edits DO touch these
// fields ("fix the client name to Acme Corp"). The rule is "entity changed
// that the instruction didn't license." Doing that perfectly is hard, so the
// deliberate call is OVER-WARN: flag generously, let the user dismiss. A false
// positive costs a glance; a false negative is the silent failure we kill.

import {
  extractFacts,
  sliceOf,
  type Fact,
  type FactKind,
  type ReportSlice,
} from './extract';

export type FactFlag = {
  kind: FactKind;
  slice: ReportSlice;
  /** Baseline values no longer present in the edit. */
  removed: string[];
  /** New values in the edit not present in the baseline. */
  added: string[];
  message: string;
};

// Verbs that signal the user is asking to CHANGE something.
const MUTATION_RE =
  /\b(change|updat|correct|fix|replac|set|adjust|revis|edit|rename|swap|amend|modif|rewrit|make it|call it|change it to|should (?:be|say|read))/i;

// Per-category cue words in the instruction that indicate the user is talking
// about that kind of fact.
const CATEGORY_CUES: Record<FactKind, RegExp> = {
  money:
    /\b(price|pricing|cost|bid|amount|dollar|\$|fee|budget|quote|total|sum|figure|value)\b/i,
  number:
    /\b(number|numbers|quantity|quantities|percent|percentage|%|count|figure|figures|amount|unit|units|value|rate)\b/i,
  date:
    /\b(date|dates|deadline|day|days|month|months|year|years|schedule|timeline|due|by (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|completion)\b/i,
  name:
    /\b(name|names|client|company|companies|firm|contractor|owner|party|parties|call it|rename|entity|vendor|title)\b/i,
};

function normalizedSet(facts: Fact[], kind: FactKind): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of facts) {
    if (f.kind !== kind) continue;
    counts.set(f.normalized, (counts.get(f.normalized) ?? 0) + 1);
  }
  return counts;
}

/** Multiset difference: values in `a` whose count exceeds `b`. */
function diff(a: Map<string, number>, b: Map<string, number>): string[] {
  const out: string[] = [];
  for (const [val, count] of a) {
    const other = b.get(val) ?? 0;
    for (let i = 0; i < count - other; i++) out.push(val);
  }
  return out.sort();
}

/**
 * Is a change to `kind` licensed by the instruction? Licensed when EITHER:
 *   (a) an added value literally appears in the instruction (the user told us
 *       the new value), OR
 *   (b) the instruction has a mutation verb AND a cue word for this category.
 * Anything else is treated as unlicensed → flagged (over-warn).
 */
function isLicensed(
  kind: FactKind,
  added: string[],
  instruction: string,
): boolean {
  const instr = instruction.toLowerCase();
  const instrDigits = instr.replace(/,/g, '');
  for (const val of added) {
    const needle = val.replace(/,/g, '');
    if (needle.length >= 2 && instrDigits.includes(needle)) return true;
  }
  return MUTATION_RE.test(instruction) && CATEGORY_CUES[kind].test(instruction);
}

const KINDS: FactKind[] = ['money', 'date', 'number', 'name'];

const LABEL: Record<FactKind, string> = {
  money: 'dollar amount',
  date: 'date',
  number: 'number',
  name: 'name',
};

/**
 * Compare baseline vs edit and return flags for UNLICENSED fact changes.
 * Empty array = clean. Used by BOTH the runtime validator (/api/edit) and the
 * offline eval (D-012) — one code path.
 */
export function compareFacts(
  baseline: string,
  edit: string,
  instruction: string,
): FactFlag[] {
  const baseFacts = extractFacts(baseline);
  const editFacts = extractFacts(edit);
  const flags: FactFlag[] = [];

  for (const kind of KINDS) {
    const baseSet = normalizedSet(baseFacts, kind);
    const editSet = normalizedSet(editFacts, kind);
    const removed = diff(baseSet, editSet);
    const added = diff(editSet, baseSet);
    if (removed.length === 0 && added.length === 0) continue; // unchanged
    if (isLicensed(kind, added, instruction)) continue; // user asked for it

    const parts: string[] = [];
    if (removed.length) parts.push(`removed ${removed.join(', ')}`);
    if (added.length) parts.push(`added ${added.join(', ')}`);
    flags.push({
      kind,
      slice: sliceOf(kind),
      removed,
      added,
      message: `Possible unlicensed ${LABEL[kind]} change (${parts.join('; ')}). The instruction didn't ask for this — review before accepting.`,
    });
  }
  return flags;
}
