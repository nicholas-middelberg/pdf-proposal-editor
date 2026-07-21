// Fidelity eval (D-013 / Req 5, Task 10).
//
// Parses fixtures/easy.pdf, runs a fixed batch of FACT-NEUTRAL instructions
// against every real paragraph, and diffs extracted facts before/after via
// lib/facts/compare.ts. Because none of the instructions license a fact
// change, any flag here is a genuine model fidelity leak, not a false alarm.
//
// Two targets, same instructions and same scoring:
//   `npm run eval`           — calls lib/ai.ts's proposeEdit directly, then
//                              scores locally with compareFacts. Same code
//                              path /api/edit uses (D-012: one path for both).
//   `npm run eval:deployed`  — POSTs to the DEPLOYED /api/edit and uses the
//                              flags that server computed. Measures the
//                              shipped product end to end, not a local
//                              re-implementation of it.
//
// Makes REAL live API calls against the pinned model — NOT wired into
// `npm test`.

import { readFile } from 'node:fs/promises';
import { extractPdfItems } from '../lib/pdf/extract';
import { segment } from '../lib/pdf/segment';
import { proposeEdit } from '../lib/ai';
import { compareFacts, type FactFlag } from '../lib/facts/compare';
import { nonEditReason } from '../lib/nonEdit';
import type { Block } from '../lib/types';

const INSTRUCTIONS = ['Tighten this up.', 'Make this more formal.', 'Fix any grammar issues.'];

/** Set to a deployment origin (no trailing slash) to score the shipped app. */
const TARGET_URL = process.env.EVAL_TARGET_URL?.replace(/\/$/, '');

type Result = {
  block: Block;
  instruction: string;
  edit: string;
  flags: FactFlag[];
};

/**
 * One edit + its flags. Against the deployed target the flags come back from
 * the server (that IS the production validator); locally they're computed
 * with the same compareFacts the server would have run.
 */
async function runEdit(
  block: Block,
  instruction: string,
): Promise<{ edit: string; flags: FactFlag[] }> {
  if (TARGET_URL) {
    const res = await fetch(`${TARGET_URL}/api/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blockId: block.id, text: block.text, instruction }),
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as { proposed: string; flags?: FactFlag[] };
    return { edit: data.proposed, flags: data.flags ?? [] };
  }
  const edit = await proposeEdit(block.text, instruction);
  // Mirror the route's own non-edit guard so the local path reports the same
  // outcome the deployed one would (which returns 502 for these).
  const nonEdit = nonEditReason(block.text, edit);
  if (nonEdit) throw new Error(`non-edit guard: ${nonEdit}`);
  return { edit, flags: compareFacts(block.text, edit, instruction) };
}

function hasSliceFlag(flags: FactFlag[], slice: 'numeric' | 'name'): boolean {
  return flags.some((f) => f.slice === slice);
}

function printExample(r: Result): void {
  console.log(`\nInstruction: "${r.instruction}"`);
  console.log(`Original: ${r.block.text}`);
  console.log(`Edit:     ${r.edit}`);
  for (const f of r.flags) console.log(`  FLAG [${f.kind}]: ${f.message}`);
}

async function main() {
  const buf = await readFile('fixtures/easy.pdf');
  const { items } = await extractPdfItems(new Uint8Array(buf));
  const blocks = segment(items).filter((b) => b.type === 'paragraph');
  const totalCalls = blocks.length * INSTRUCTIONS.length;

  console.log(
    `Evaluating ${blocks.length} paragraphs x ${INSTRUCTIONS.length} instructions = ${totalCalls} edit calls against fixtures/easy.pdf...`,
  );
  console.log(`Target: ${TARGET_URL ? `DEPLOYED ${TARGET_URL}/api/edit` : 'local proposeEdit()'}\n`);

  const results: Result[] = [];
  // A transient failure partway through shouldn't discard a paid run — record
  // it, keep going, and report the count alongside the rates.
  const errors: { block: Block; instruction: string; message: string }[] = [];

  for (const block of blocks) {
    for (const instruction of INSTRUCTIONS) {
      try {
        const { edit, flags } = await runEdit(block, instruction);
        results.push({ block, instruction, edit, flags });
        process.stdout.write('.');
      } catch (err) {
        errors.push({ block, instruction, message: err instanceof Error ? err.message : String(err) });
        process.stdout.write('x');
      }
    }
  }
  console.log('\n');

  // A guard rejection is a SUCCESS of the product (the model misbehaved and
  // was caught before the user saw it), not an infrastructure failure — so
  // report the two separately instead of burying both as "errors".
  const guardRejections = errors.filter((e) => /non-edit|replied instead of editing/i.test(e.message));
  const otherErrors = errors.filter((e) => !guardRejections.includes(e));

  if (guardRejections.length) {
    console.log(
      `=== ${guardRejections.length} response(s) refused by the non-edit guard (model replied instead of editing) ===`,
    );
    for (const e of guardRejections) {
      console.log(`  "${e.instruction}" on: ${e.block.text.slice(0, 70)}`);
    }
    console.log('');
  }
  if (otherErrors.length) {
    console.log(`=== ${otherErrors.length} call(s) failed for other reasons ===`);
    for (const e of otherErrors.slice(0, 5)) console.log(`  "${e.instruction}" -> ${e.message}`);
    console.log('');
  }

  const numericLeaks = results.filter((r) => hasSliceFlag(r.flags, 'numeric')).length;
  const nameLeaks = results.filter((r) => hasSliceFlag(r.flags, 'name')).length;
  const total = results.length;
  const numericFidelity = ((total - numericLeaks) / total) * 100;
  const nameFidelity = ((total - nameLeaks) / total) * 100;

  console.log('=== Fidelity rates (fact-neutral instructions; any flag = fidelity leak) ===');
  console.log(
    `Numeric (money/date/number): ${numericFidelity.toFixed(1)}% (${total - numericLeaks}/${total} clean)`,
  );
  console.log(`Name:                        ${nameFidelity.toFixed(1)}% (${total - nameLeaks}/${total} clean)`);

  const leaked = results.filter((r) => r.flags.length > 0);
  const clean = results.filter((r) => r.flags.length === 0);

  console.log(`\n=== Worked examples: ${Math.min(2, clean.length)} clean ===`);
  for (const r of clean.slice(0, 2)) printExample(r);

  console.log(`\n=== Worked examples: ${leaked.length} leaked (showing up to 5) ===`);
  if (leaked.length === 0) console.log('(none)');
  for (const r of leaked.slice(0, 5)) printExample(r);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
