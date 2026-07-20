// Word-level diff for DiffView. Plain LCS dynamic programming over
// whitespace-preserving word tokens — small, dependency-free, and inspectable
// (same rationale as regex over NER in lib/facts/extract.ts: this project
// prefers auditable logic over an opaque library where the scope allows it).

export type DiffToken = { text: string; kind: 'same' | 'removed' | 'added' };

/** Splits on whitespace boundaries while keeping the whitespace itself as
 * tokens, so the diff can be rejoined into exactly the original text. */
function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t.length > 0);
}

export function diffWords(a: string, b: string): DiffToken[] {
  const aWords = tokenize(a);
  const bWords = tokenize(b);
  const n = aWords.length;
  const m = bWords.length;

  // dp[i][j] = length of the LCS of aWords[i..] and bWords[j..].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        aWords[i] === bWords[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aWords[i] === bWords[j]) {
      tokens.push({ text: aWords[i], kind: 'same' });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      tokens.push({ text: aWords[i], kind: 'removed' });
      i++;
    } else {
      tokens.push({ text: bWords[j], kind: 'added' });
      j++;
    }
  }
  while (i < n) tokens.push({ text: aWords[i++], kind: 'removed' });
  while (j < m) tokens.push({ text: bWords[j++], kind: 'added' });

  return tokens;
}
