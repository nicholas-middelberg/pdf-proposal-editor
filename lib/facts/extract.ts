// Deterministic fact extraction (D-013). Four categories matter for a
// construction bid: money, dates, numbers, names.
//
// Numbers / dates / $ HAVE SHAPES — regex extracts them with near-perfect
// recall, zero deps, and is inspectable. Names have NO shape — regex here is
// just capitalized-word runs: noisy, over/under-catches. That is the weak axis,
// reported separately as a floor (D-013), not engineered around here.
//
// Extraction masks matched spans left-to-right (money → date → number) so a
// dollar figure is not also double-counted as a bare number.

export type FactKind = 'money' | 'date' | 'number' | 'name';

/** Which reporting slice a fact belongs to (D-013: never blend the two). */
export type ReportSlice = 'numeric' | 'name';

export function sliceOf(kind: FactKind): ReportSlice {
  return kind === 'name' ? 'name' : 'numeric';
}

export type Fact = {
  kind: FactKind;
  /** The raw matched text. */
  raw: string;
  /** Canonical form used for equality comparison. */
  normalized: string;
};

const MONTHS =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

// Order matters: earlier patterns mask their spans before later ones run.
const MONEY_RE = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?\s?(?:million|billion|thousand|[mbk])?\b|\b\d+(?:\.\d+)?\s?(?:million|billion)\s+dollars\b/gi;

const DATE_RE = new RegExp(
  [
    '\\b\\d{4}-\\d{2}-\\d{2}\\b', // ISO 2026-01-15
    '\\b\\d{1,2}/\\d{1,2}/\\d{2,4}\\b', // 01/15/2026
    `\\b${MONTHS}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, // Jan 15, 2026
    `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTHS}\\.?,?\\s+\\d{4}\\b`, // 15 Jan 2026
    `\\b${MONTHS}\\.?\\s+\\d{4}\\b`, // January 2026
  ].join('|'),
  'gi',
);

const PERCENT_RE = /\b\d+(?:\.\d+)?\s?%|\b\d+(?:\.\d+)?\s?percent\b/gi;
const NUMBER_RE = /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\b/g;

// Capitalized-word runs. A lowercase connector (of/the/and/for/&) only extends
// a run when it GLUES TWO capitalized words ("City of Oakland", "Smith & Jones")
// — it can't dangle off a sentence-initial verb ("Work for the ..."). Still a
// deliberately weak heuristic that over/under-catches (D-013).
const NAME_RE =
  /\b[A-Z][A-Za-z&.]*(?:\s+(?:of\s+|the\s+|and\s+|for\s+|&\s+)?[A-Z][A-Za-z&.]*)*\b/g;

function normMoney(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\$|,|\s|dollars/g, '')
    .replace('million', 'm')
    .replace('billion', 'b')
    .replace('thousand', 'k');
}

function normDate(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/(\d+)(?:st|nd|rd|th)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function normNumber(raw: string): string {
  return raw.toLowerCase().replace(/,|\s/g, '');
}

function normName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Common capitalized words that are almost never proper names. Keeps the noisy
// name axis from drowning in sentence-initial words. Intentionally small —
// name detection stays deliberately weak (D-013).
const NAME_STOPWORDS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'we', 'our', 'i', 'it',
  'he', 'she', 'they', 'you', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or',
  'but', 'if', 'as', 'by', 'with', 'from', 'per', 'all', 'each', 'any', 'no',
]);

function collect(
  text: string,
  re: RegExp,
  kind: FactKind,
  normalize: (s: string) => string,
  mask: boolean[],
): Fact[] {
  const out: Fact[] = [];
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    const raw = m[0];
    // Skip if any character of this span was already claimed by an earlier kind.
    let claimed = false;
    for (let i = start; i < start + raw.length; i++) {
      if (mask[i]) {
        claimed = true;
        break;
      }
    }
    if (claimed) continue;
    if (mask.length) {
      for (let i = start; i < start + raw.length; i++) mask[i] = true;
    }
    out.push({ kind, raw: raw.trim(), normalized: normalize(raw) });
  }
  return out;
}

export function extractFacts(text: string): Fact[] {
  const mask = new Array<boolean>(text.length).fill(false);
  const facts: Fact[] = [];
  facts.push(...collect(text, MONEY_RE, 'money', normMoney, mask));
  facts.push(...collect(text, DATE_RE, 'date', normDate, mask));
  facts.push(...collect(text, PERCENT_RE, 'number', normNumber, mask));
  facts.push(...collect(text, NUMBER_RE, 'number', normNumber, mask));

  // Names reuse the SAME mask as the numeric kinds so capitalized month words
  // inside a date span ("January 15, 2026") are not also picked up as names.
  // Bare numbers never match the name regex, so this can't fragment a real name.
  for (const f of collect(text, NAME_RE, 'name', normName, mask)) {
    const isSingleStopword =
      !f.normalized.includes(' ') && NAME_STOPWORDS.has(f.normalized);
    if (isSingleStopword) continue;
    facts.push(f);
  }
  return facts;
}

/** Facts grouped by kind, as normalized-value multisets (sorted arrays). */
export function factsByKind(text: string): Record<FactKind, string[]> {
  const groups: Record<FactKind, string[]> = {
    money: [],
    date: [],
    number: [],
    name: [],
  };
  for (const f of extractFacts(text)) groups[f.kind].push(f.normalized);
  for (const k of Object.keys(groups) as FactKind[]) groups[k].sort();
  return groups;
}
