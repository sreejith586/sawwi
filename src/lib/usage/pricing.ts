// Anthropic list prices, in US dollars per million tokens. The one place prices live:
// the usage dashboard, its Excel export and the admin view all price calls from here.
//
// Source: Anthropic first-party API pricing (platform.claude.com pricing page), as cached
// in the claude-api reference on 2026-10-06. Cache reads are 0.1x input (0.05x on Opus 5.5).
// Cache writes are priced at the 1-hour TTL (2x input), because every Sawwi call caches
// its prefix with ttl "1h" (D-4, D-17). Haiku 5.5's price is for prompts up to 100K
// tokens; Sawwi's prompts are a few thousand tokens, so the higher tier never applies.
// Opus 5.5 and Fable 5.1 are listed so a Sonnet call served by the refusal fallback is
// still priced. Update the date when prices change.

export const PRICES_AS_OF = "2026-10-06";
export const PRICES_SOURCE = "Anthropic API list prices (first-party), cache writes at the 1-hour TTL";

export type ModelPrice = {
  label: string;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
};

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-haiku-5-5": { label: "Haiku 5.5", input: 0.1, cacheRead: 0.01, cacheWrite: 0.2, output: 0.5 },
  "claude-sonnet-5-5": { label: "Sonnet 5.5", input: 2, cacheRead: 0.2, cacheWrite: 4, output: 10 },
  "claude-opus-5-5": { label: "Opus 5.5", input: 4, cacheRead: 0.2, cacheWrite: 8, output: 20 },
  "claude-fable-5-1": { label: "Fable 5.1", input: 10, cacheRead: 0.25, cacheWrite: 20, output: 50 },
};

/** Exact id first, then the longest listed id the model starts with (e.g. a dated snapshot). */
export function priceFor(model: string): ModelPrice | undefined {
  if (MODEL_PRICES[model]) return MODEL_PRICES[model];
  const match = Object.keys(MODEL_PRICES)
    .filter((id) => model.startsWith(`${id}-`))
    .sort((a, b) => b.length - a.length)[0];
  return match ? MODEL_PRICES[match] : undefined;
}

export const modelLabel = (model: string) => priceFor(model)?.label ?? model;

export type TokenCounts = { inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number };

/** Estimated cost in USD, or null when the model has no listed price. */
export function costOf(model: string, t: TokenCounts): number | null {
  const p = priceFor(model);
  if (!p) return null;
  return (t.inputTokens * p.input + t.cacheReadTokens * p.cacheRead + t.cacheWriteTokens * p.cacheWrite + t.outputTokens * p.output) / 1_000_000;
}
