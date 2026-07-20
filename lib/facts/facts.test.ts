import { describe, it, expect } from 'vitest';
import { extractFacts, factsByKind } from './extract';
import { compareFacts } from './compare';

describe('extractFacts — money', () => {
  it('extracts dollar figures and does not double-count them as numbers', () => {
    const g = factsByKind('The bid is $1,250,000 for the project.');
    expect(g.money).toEqual(['1250000']);
    expect(g.number).toEqual([]); // masked, not double-counted
  });

  it('handles magnitude suffixes', () => {
    const g = factsByKind('Budget of $1.2M approved.');
    expect(g.money).toEqual(['1.2m']);
  });
});

describe('extractFacts — dates', () => {
  it('extracts several date shapes', () => {
    expect(factsByKind('Due January 15, 2026.').date).toEqual(['january 15 2026']);
    expect(factsByKind('Due 2026-01-15.').date).toEqual(['2026-01-15']);
    expect(factsByKind('Due 15 Jan 2026.').date).toEqual(['15 jan 2026']);
  });
});

describe('extractFacts — numbers', () => {
  it('extracts percentages and plain numbers', () => {
    const g = factsByKind('A 15% retention over 24 months.');
    expect(g.number.sort()).toEqual(['15%', '24']);
  });
});

describe('extractFacts — names (weak axis)', () => {
  it('catches multi-word capitalized runs incl. connectors', () => {
    const names = factsByKind('Work for the City of Oakland by Acme Corp.').name;
    expect(names).toContain('city of oakland');
    expect(names).toContain('acme corp');
  });
});

describe('compareFacts — flags unlicensed numeric changes (the headline risk)', () => {
  it('flags a silently changed dollar amount on a "tighten" edit', () => {
    const flags = compareFacts(
      'The total bid is $1,250,000.',
      'The total bid is $1,300,000.',
      'tighten this',
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].kind).toBe('money');
    expect(flags[0].slice).toBe('numeric');
    expect(flags[0].removed).toEqual(['1250000']);
    expect(flags[0].added).toEqual(['1300000']);
  });

  it('flags a silently changed date on a "make it formal" edit', () => {
    const flags = compareFacts(
      'Completion by January 15, 2026.',
      'Completion by January 30, 2026.',
      'make it more formal',
    );
    expect(flags.some((f) => f.kind === 'date')).toBe(true);
  });
});

describe('compareFacts — does NOT flag licensed changes (not a bare diff)', () => {
  it('no flag when the instruction supplies the new value', () => {
    const flags = compareFacts(
      'The bid is $1,250,000.',
      'The bid is $1,300,000.',
      'update the bid to $1,300,000',
    );
    expect(flags).toEqual([]);
  });

  it('no flag when instruction has a mutation verb + category cue', () => {
    const flags = compareFacts(
      'Deadline is January 15, 2026.',
      'Deadline is February 1, 2026.',
      'change the deadline date',
    );
    expect(flags).toEqual([]);
  });

  it('no flag for a licensed name change', () => {
    const flags = compareFacts(
      'Prepared for Acme Corp.',
      'Prepared for Globex Corp.',
      'fix the client name to Globex Corp',
    );
    expect(flags).toEqual([]);
  });
});

describe('compareFacts — clean edits produce no flags', () => {
  it('no flag when facts are preserved', () => {
    const flags = compareFacts(
      'The total bid is $1,250,000, due January 15, 2026.',
      'The bid totals $1,250,000 and is due January 15, 2026.',
      'tighten this',
    );
    expect(flags).toEqual([]);
  });
});

describe('compareFacts — reporting split (D-013)', () => {
  it('separates numeric and name slices, never blended', () => {
    const flags = compareFacts(
      'Acme Corp bid $1,250,000.',
      'Globex Corp bid $1,300,000.',
      'tighten this',
    );
    const slices = flags.map((f) => f.slice).sort();
    expect(slices).toEqual(['name', 'numeric']);
  });
});
