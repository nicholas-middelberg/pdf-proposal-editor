// The ONLY server route (D-011) — parsing stays client-side, this route's
// one job is holding PROXY_TOKEN and calling the LLM (D-010). It handles two
// request shapes on one URL rather than adding a second route: a paragraph
// edit (rung 2, D-012) and "re-detect sections with AI" (D-003), which sends
// positioned items, not flat text. One completion per call, no streaming
// (D-010): the D-013 validator needs the complete text before a diff can be
// shown, so streaming would only buy "watch it type," not "act on it sooner."

import { NextResponse } from 'next/server';
import { getAnthropicClient, EDIT_MODEL, proposeEdit } from '../../../lib/ai';
import { compareFacts } from '../../../lib/facts/compare';
import { paragraphLengthError } from '../../../lib/limits';
import { nonEditReason } from '../../../lib/nonEdit';
import { dedupe } from '../../../lib/pdf/segment';
import { reconstructBlocks } from '../../../lib/pdf/reconstruct';
import type { EditProposal, EditRequest, ParseResult, PositionedItem } from '../../../lib/types';

// Re-detect on a full document (hundreds of items) has been observed to take
// well over a minute end to end, well past Vercel's default serverless
// timeout. Extends the allowed execution time for this route on deploy —
// verify against the actual Vercel plan at deploy time (Task 11), the real
// ceiling varies by plan.
export const maxDuration = 120;

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

type RedetectRequest = { items: PositionedItem[] };

function isRedetectRequest(body: unknown): body is RedetectRequest {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return Array.isArray(b.items);
}

async function handleEdit({ blockId, text, instruction }: EditRequest) {
  // Flag B: block over-cap / empty paragraphs before spending a call. Never
  // truncate — truncation silently drops trailing facts.
  const lengthError = paragraphLengthError(text);
  if (lengthError) {
    return NextResponse.json({ error: lengthError }, { status: 400 });
  }

  let proposed: string;
  try {
    proposed = await proposeEdit(text, instruction);
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

  // The model sometimes replies ABOUT the task instead of doing it (observed
  // live: a short date/project-number line came back as "Please provide the
  // paragraph you'd like me to tighten up."). That is not a bad edit for the
  // user to judge — it is a non-answer, so it is refused here rather than
  // rendered as an accept-able proposal. See lib/nonEdit.ts.
  const nonEdit = nonEditReason(text, proposed);
  if (nonEdit) {
    console.error(
      'POST /api/edit: response rejected as a non-edit —', nonEdit,
      '| instruction:', JSON.stringify(instruction),
      '| response (first 300 chars):', proposed.slice(0, 300),
    );
    return NextResponse.json(
      { error: 'The AI replied instead of editing the paragraph. Please try again.' },
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

// The model only chooses groupings + reading order over items WE supply —
// it never gets to invent block text itself, so a bad response can misorder
// or misgroup but can't hallucinate new paragraph content into the document.
const REDETECT_SYSTEM_PROMPT = `You segment a document into ordered blocks from a flat list of positioned text items (each has an index "i", its "text", and "x"/"y" position on the page).

Group the items into blocks — headings and paragraphs — in correct reading order. Use the x/y positions to detect and correct multi-column layouts (read down one column before starting the next).

Return ONLY JSON: an array of objects, each { "type": "heading" | "paragraph", "itemIndices": number[] }, in final reading order. Every item index must appear in exactly one group. No prose, no markdown code fences — JSON only.`;

function stripCodeFence(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (match ? match[1] : text).trim();
}

async function handleRedetect({ items: rawItems }: RedetectRequest) {
  if (rawItems.length === 0) {
    return NextResponse.json({ error: 'Nothing to re-detect.' }, { status: 400 });
  }

  // Same de-duplication the deterministic path uses (segment.ts): pdf.js
  // sometimes emits the identical glyph run twice (bold/shadow rendering).
  // Without this the model sees doubled text and often groups the
  // duplicates together, producing headings like "Statement of Statement of
  // Qualifications Qualifications". itemIndices below refer to this
  // deduped array, not the original request payload.
  const items = dedupe(rawItems);

  // Trim to what the model actually needs (D-003) — not bbox/fontSize.
  const payload = items.map((it, i) => ({
    i,
    text: it.text,
    x: Math.round(it.x),
    y: Math.round(it.y),
    page: it.page,
  }));

  let raw: string;
  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: EDIT_MODEL,
      max_tokens: 32000,
      system: REDETECT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    });
    if (response.stop_reason === 'max_tokens') {
      console.error(
        `POST /api/edit (redetect): response truncated at max_tokens (${items.length} items)`,
      );
      return NextResponse.json(
        { error: 'Re-detect ran out of space for this document. Please try again.' },
        { status: 502 },
      );
    }
    const block = response.content.find((b) => b.type === 'text');
    raw = block?.type === 'text' ? block.text.trim() : '';
  } catch (err) {
    console.error('POST /api/edit (redetect): model call failed', err);
    return NextResponse.json({ error: 'Re-detect failed. Please try again.' }, { status: 502 });
  }

  let groups: unknown;
  try {
    groups = JSON.parse(stripCodeFence(raw));
  } catch (err) {
    console.error(
      'POST /api/edit (redetect): could not parse model response as JSON.',
      'error:', err,
      'raw response (first 4000 chars):', raw.slice(0, 4000),
    );
    return NextResponse.json(
      { error: 'Re-detect returned an unreadable response. Please try again.' },
      { status: 502 },
    );
  }

  const blocks = reconstructBlocks(items, groups);
  if (!blocks) {
    console.error(
      'POST /api/edit (redetect): model response failed validation (bad/incomplete grouping).',
      'itemCount:', items.length,
      'groups (first 4000 chars):', JSON.stringify(groups).slice(0, 4000),
    );
    return NextResponse.json(
      { error: 'Re-detect returned an invalid section layout. Please try again.' },
      { status: 502 },
    );
  }

  const result: ParseResult = { blocks, method: 'ai' };
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (isRedetectRequest(body)) return handleRedetect(body);
  if (isEditRequest(body)) return handleEdit(body);

  return NextResponse.json(
    { error: 'Request must include blockId/text/instruction, or items to re-detect.' },
    { status: 400 },
  );
}
