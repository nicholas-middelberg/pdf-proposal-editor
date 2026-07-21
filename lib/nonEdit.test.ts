import { describe, it, expect } from 'vitest';
import { nonEditReason } from './nonEdit';

describe('nonEditReason — the real observed failure', () => {
  // Captured verbatim from an eval run against the deployed app.
  const original = 'April 14, 2025 Project No. 041-560';

  it('rejects the chatter the model actually returned', () => {
    const proposed = "Please provide the paragraph you'd like me to tighten up.";
    expect(nonEditReason(original, proposed)).not.toBeNull();
  });

  it('accepts the legitimate tightening of that same line', () => {
    expect(nonEditReason(original, 'April 14, 2025 | Project No. 041-560')).toBeNull();
  });

  it('accepts a reformatting that splits the line across rows', () => {
    expect(nonEditReason(original, 'April 14, 2025\nProject No. 041-560')).toBeNull();
  });
});

describe('nonEditReason — other ways a model declines the task', () => {
  const original =
    'MECO Engineering is celebrating its 40th anniversary this year, serving municipalities across Missouri.';

  it('rejects an apology/refusal', () => {
    expect(
      nonEditReason(original, "I'm sorry, but I cannot help with that request."),
    ).not.toBeNull();
  });

  it('rejects a request for clarification', () => {
    expect(
      nonEditReason(original, 'Could you please clarify what tone you are going for?'),
    ).not.toBeNull();
  });

  it('rejects "it looks like you didn\'t provide..."', () => {
    expect(
      nonEditReason(original, "It looks like you haven't provided any text to work with."),
    ).not.toBeNull();
  });
});

describe('nonEditReason — legitimate edits are not rejected', () => {
  it('accepts a light copy-edit', () => {
    const original = 'MECO currently has seven office locations, with one in Jefferson City, MO.';
    const proposed = 'MECO currently operates seven offices, including one in Jefferson City, MO.';
    expect(nonEditReason(original, proposed)).toBeNull();
  });

  it('accepts a substantial tone rewrite that keeps the subject matter', () => {
    const original =
      'We take pride in earning the majority of our business from repeat, satisfied customers.';
    const proposed =
      'The majority of our business comes from repeat customers — a source of considerable pride.';
    expect(nonEditReason(original, proposed)).toBeNull();
  });

  it('accepts an aggressive shortening', () => {
    const original =
      'MECO Engineering is celebrating its 40th anniversary this year. This long-spanning career has been built on serving municipalities such as yours.';
    const proposed = 'Now in its 40th year, MECO Engineering has long served municipalities like yours.';
    expect(nonEditReason(original, proposed)).toBeNull();
  });

  it('does NOT reject real proposal language that begins "Please provide..."', () => {
    // The false positive a phrase-match-only guard would produce: RFP response
    // language is full of this construction. Retention keeps it safe.
    const original = 'Please provide the following documents by June 1, 2025 for review.';
    const proposed = 'Please provide the following documents for review by June 1, 2025.';
    expect(nonEditReason(original, proposed)).toBeNull();
  });

  it('does NOT reject an edit that adds "let me know" style language to a cover letter', () => {
    const original =
      'We look forward to hearing from you. Contact Don Jenkins at 573-893-5558 with questions.';
    const proposed =
      'We look forward to hearing from you — please let me know if questions arise; Don Jenkins is available at 573-893-5558.';
    expect(nonEditReason(original, proposed)).toBeNull();
  });
});

describe('nonEditReason — guards against its own false positives', () => {
  it('does not apply the zero-retention rule to a very short original', () => {
    // Too little signal to call it: "Sincerely," -> "Respectfully," is a fine
    // edit that happens to share no content tokens.
    expect(nonEditReason('Sincerely,', 'Respectfully,')).toBeNull();
  });

  it('treats an original with no content tokens as unjudgeable', () => {
    expect(nonEditReason('   ', 'anything at all')).toBeNull();
  });

  it('is case- and punctuation-insensitive when matching retained content', () => {
    const original = 'DIXON, MO 65459';
    const proposed = 'Dixon, Missouri 65459';
    expect(nonEditReason(original, proposed)).toBeNull();
  });
});
