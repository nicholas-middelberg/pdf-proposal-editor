// Server-only Anthropic client (D-010). Import this ONLY from
// app/api/*/route.ts handlers — never from a client component, and never
// re-export PROXY_TOKEN itself. The proxy is a drop-in replacement for the
// official API; only baseURL + apiKey differ from a normal Anthropic setup.

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
