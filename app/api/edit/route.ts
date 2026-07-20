// The ONLY server route (D-011) — parsing stays client-side, this route's
// one job is holding PROXY_TOKEN and calling the LLM (D-010). One completion
// per edit, no streaming (D-010): the D-013 validator needs the complete
// text before a diff can be shown, so streaming would only buy "watch it
// type," not "act on it sooner."

import { NextResponse } from 'next/server';
import { getAnthropicClient, EDIT_MODEL } from '../../../lib/ai';
import { compareFacts } from '../../../lib/facts/compare';
import { paragraphLengthError } from '../../../lib/limits';
import type { EditProposal, EditRequest } from '../../../lib/types';

// Fixes the role, forbids changing facts unless instructed, and asks for the
// revised paragraph only — no preamble, so the diff stays clean (D-012).
const SYSTEM_PROMPT = `You are an editing assistant for AEC (architecture, engineering, construction) proposal documents.

You will be given one paragraph from a proposal and an instruction describing how to change it. Rewrite the paragraph according to the instruction.

Rules:
- Do not change any number, date, dollar amount, or proper name (people, companies, places) unless the instruction explicitly asks you to change that specific fact.
- Make only the change the instruction asks for. Do not "improve" unrelated parts of the paragraph.
- Return ONLY the revised paragraph text. No preamble, no explanation, no quotation marks, no markdown formatting.`;

function isEditRequest(body: unknown): body is EditRequest {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.blockId === 'string' &&
    b.blockId.length > 0 &&
    typeof b.text === 'string' &&
    typeof b.instruction === 'string' &&
    b.instruction.trim().length > 0
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!isEditRequest(body)) {
    return NextResponse.json(
      { error: 'Request must include blockId, text, and a non-empty instruction.' },
      { status: 400 },
    );
  }
  const { blockId, text, instruction } = body;

  // Flag B: block over-cap / empty paragraphs before spending a call. Never
  // truncate — truncation silently drops trailing facts.
  const lengthError = paragraphLengthError(text);
  if (lengthError) {
    return NextResponse.json({ error: lengthError }, { status: 400 });
  }

  let proposed: string;
  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: EDIT_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Instruction: ${instruction}\n\nParagraph:\n${text}`,
        },
      ],
    });
    const block = response.content.find((b) => b.type === 'text');
    proposed = block?.type === 'text' ? block.text.trim() : '';
  } catch (err) {
    console.error('POST /api/edit: model call failed', err);
    return NextResponse.json({ error: 'The AI edit failed. Please try again.' }, { status: 502 });
  }

  if (!proposed) {
    return NextResponse.json(
      { error: 'The AI returned an empty response. Please try again.' },
      { status: 502 },
    );
  }

  // D-012 rung 2: deterministic validation runs on the complete edit before
  // it's handed back as an accept/reject-able diff.
  const flags = compareFacts(text, proposed, instruction);

  // Req 5 / D-012: log the {original, instruction, edit} triple so
  // scripts/eval.ts (Task 10) can score fidelity offline.
  console.log('EDIT_LOG', JSON.stringify({ original: text, instruction, edit: proposed }));

  const proposal: EditProposal = { blockId, original: text, proposed, flags };
  return NextResponse.json(proposal);
}
