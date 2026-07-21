// Server-only Anthropic client (D-010). Import this ONLY from
// app/api/*/route.ts handlers or scripts/eval.ts (a Node script, not a
// client component) — never from a client component, and never re-export
// PROXY_TOKEN itself. The proxy is a drop-in replacement for the official
// API; only baseURL + apiKey differ from a normal Anthropic setup.

import Anthropic from '@anthropic-ai/sdk';

// Pinned, not a floating alias (D-010/D-012). Confirmed served by the live
// hiring proxy (verified with real edit calls) — see README "Model".
export const EDIT_MODEL = 'claude-sonnet-5';

const PROXY_BASE_URL = 'https://hiring-proxy.trybuoyant.ai/anthropic';

/**
 * Lazily constructed so a missing token fails at request time with a clear
 * server-side error, not at module load / build time.
 */
export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.PROXY_TOKEN;
  if (!apiKey) {
    throw new Error('PROXY_TOKEN is not set. Add it to .env.local (see .env.example).');
  }
  return new Anthropic({ apiKey, baseURL: PROXY_BASE_URL });
}

// Fixes the role, forbids changing facts unless instructed, and asks for the
// revised paragraph only — no preamble, so the diff stays clean (D-012).
export const EDIT_SYSTEM_PROMPT = `You are an editing assistant for AEC (architecture, engineering, construction) proposal documents.

You will be given one paragraph from a proposal and an instruction describing how to change it. Rewrite the paragraph according to the instruction.

Rules:
- Do not change any number, date, dollar amount, or proper name (people, companies, places) unless the instruction explicitly asks you to change that specific fact.
- Make only the change the instruction asks for. Do not "improve" unrelated parts of the paragraph.
- The paragraph may be a short fragment rather than prose — an address, a date line, a project number, an attention line, a signature block. That is still the paragraph. Edit it in place; never ask for a different one.
- If the instruction cannot meaningfully improve the paragraph, return the paragraph exactly as it was given. That is a valid response.
- Never address the user, ask a question, apologize, or explain yourself. Your entire response is inserted directly into the proposal document.
- Return ONLY the revised paragraph text. No preamble, no explanation, no quotation marks, no markdown formatting.`;

/**
 * One edit completion (D-010: no streaming). Shared by /api/edit
 * (app/api/edit/route.ts) and the offline eval (scripts/eval.ts) — one code
 * path, same as compareFacts (lib/facts/compare.ts), so the eval measures
 * the exact behavior production uses, not a re-implementation of it.
 */
export async function proposeEdit(text: string, instruction: string): Promise<string> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: EDIT_MODEL,
    max_tokens: 4096,
    system: EDIT_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Instruction: ${instruction}\n\nParagraph:\n${text}` }],
  });
  const block = response.content.find((b) => b.type === 'text');
  return block?.type === 'text' ? block.text.trim() : '';
}
