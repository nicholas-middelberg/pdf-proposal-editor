// Offline fidelity eval (D-013 / Req 5, Task 10).
//
// Parses fixtures/easy.pdf, runs a fixed batch of FACT-NEUTRAL instructions
// against every real paragraph, and diffs extracted facts before/after via
// lib/facts/compare.ts — the exact same module (and the exact same edit call,
// lib/ai.ts's proposeEdit) that /api/edit uses at runtime (D-012: one code
// path for both). Because none of the instructions license a fact change, any
// flag here is a genuine model fidelity leak, not a false alarm.
//
// Makes REAL live API calls against the pinned model — NOT wired into
// `npm test`. Run manually: `npm run eval`.

import { readFile } from 'node:fs/promises';
import { extractPdfItems } from '../lib/pdf/extract';
import { segment } from '../lib/pdf/segment';
import { proposeEdit } from '../lib/ai';
import { compareFacts, type FactFlag } from '../lib/facts/compare';
import type { Block } from '../lib/types';

const INSTRUCTIONS = ['Tighten this up.', 'Make this more formal.', 'Fix any grammar issues.'];

type Result = {
  block: Block;
  instruction: string;
  edit: string;
  flags: FactFlag[];
};

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

  const results: Result[] = [];
  for (const block of blocks) {
    for (const instruction of INSTRUCTIONS) {
      const edit = await proposeEdit(block.text, instruction);
      const flags = compareFacts(block.text, edit, instruction);
      results.push({ block, instruction, edit, flags });
      process.stdout.write('.');
    }
  }
  console.log('\n');

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
