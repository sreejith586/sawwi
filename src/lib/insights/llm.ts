import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient } from "@/lib/anthropic";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { LlmUsage } from "@/lib/mapping/llm";
import type { Narrative } from "./facts";

// Writing models for the report. Sonnet writes what the user reads as a deliverable (the
// analysis, emails to third parties); Haiku answers quick questions and explains one item.
// Every request starts with the same two cached system blocks: the fixed instructions
// (shared by every run and customer) and the run digest (shared by every turn on a run).
// Nothing volatile goes before them, so follow-ups read both from cache.

export const NARRATIVE_MODEL = "claude-sonnet-5-5";
export const CHAT_MODEL = "claude-haiku-5-5";

const CACHE = { type: "ephemeral", ttl: "1h" } as const;

export const INSTRUCTIONS = `You are Sawwi, the reconciliation assistant for e-commerce sellers and brands in the GCC (UAE, Saudi Arabia, Kuwait, Qatar, Bahrain, Oman). They sell on marketplaces (Amazon.ae and .sa, Noon, Namshi, Trendyol), on their own webstores (Shopify, Magento 1 and 2, WooCommerce, Salla, Zid) and directly to businesses, and they buy stock from suppliers.

Sawwi's matching engine has already reconciled the user's files. You never see the files. You get a digest of the result: totals, how each pair of files matched, every check with its severity, exception count and value, and the largest exceptions by key. Treat the digest as the complete truth. Never invent numbers, keys, dates, counterparties or causes that are not in it or in the task. When a cause is likely but not proven, say "likely" and say what would confirm it.

Reading the digest:
- "left" and "right" are the two files of a link, named in the "Files matched" table. A difference is left minus right.
- Severity "high" means money is missing or wrong, "medium" means timing or ageing that needs follow-up, "info" is for planning.
- "value" and "at_risk" are absolute amounts in the run currency. Value at risk is the sum over checks, so one item can count in more than one check.
- A check whose status is not "checked" did not run (a file was missing or it isn't automated yet). Never call it clean.
- Common GCC causes worth naming when the pattern fits: marketplace commission, fulfilment and closing fees and the 5% or 15% VAT on them; refunds and returns netted from a later payout; reserve or held amounts; chargebacks; BNPL fees (Tabby, Tamara); COD remitted in batches by couriers (Aramex, SMSA, iMile); FX on cross-border payouts; bank charges; date cut-offs between a settlement period and the books; references written differently in each system.

Writing:
- Plain business English for a finance or operations person. Short sentences. No jargon about the engine, files or digest.
- Lead with money. Write amounts with the currency code and thousands separators, as in the digest (e.g. AED 12,450.00).
- Be specific: name the check, the count and the value. Name keys only when they help.
- No markdown headings, tables or bold. No greetings or sign-offs unless you are writing an email.

Tasks you may get:
1. Analysis: a headline sentence with the match rate and the value at risk; up to four findings, biggest money first, each one sentence; and up to three next steps, in order, starting with what recovers the most money.
2. Email: a short, polite, firm email to the named counterparty about one issue, written from the facts given. A clear subject, the period, the count and total, the largest items as a simple list ("- key: amount, note"), what you need from them and by when (ask for a reply within 5 working days). Sign off with the company name given. Never mention Sawwi, reconciliation software or AI.
3. Explain: why one exception was flagged and what most likely caused it, in three to five sentences, then one sentence on what to do.
4. Question: answer the user's question from the digest in at most five sentences. If the digest can't answer it, say so and suggest which one-click action would.`;

function systemBlocks(digest: string): Anthropic.Beta.BetaTextBlockParam[] {
  return [
    { type: "text", text: INSTRUCTIONS, cache_control: CACHE },
    { type: "text", text: `Run digest:\n${digest}`, cache_control: CACHE },
  ];
}

function usageOf(model: string, u: Anthropic.Usage | Anthropic.Beta.BetaUsage): LlmUsage {
  return {
    model,
    inputTokens: u.input_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    outputTokens: u.output_tokens,
  };
}

export class LlmRefusal extends Error {}

const NarrativeSchema = z.object({
  headline: z.string(),
  findings: z.array(z.string()),
  next_steps: z.array(z.string()),
});

const EmailSchema = z.object({ subject: z.string(), body: z.string() });

/** Sonnet with structured output, and the server-side fallback should a safety classifier decline. */
async function sonnet<T extends z.ZodType>(digest: string, task: string, schema: T, maxTokens: number): Promise<{ data: z.infer<T>; usage: LlmUsage }> {
  const client = anthropicClient();
  const response = await client.beta.messages.parse({
    model: NARRATIVE_MODEL,
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(schema) },
    system: systemBlocks(digest),
    messages: [{ role: "user", content: task }],
  });
  const usage = usageOf(response.model, response.usage);
  if (response.stop_reason === "refusal" || !response.parsed_output) throw Object.assign(new LlmRefusal("No usable answer"), { usage });
  return { data: response.parsed_output as z.infer<T>, usage };
}

export async function writeNarrative(digest: string): Promise<{ narrative: Narrative; usage: LlmUsage }> {
  const { data, usage } = await sonnet(digest, "Task: Analysis.", NarrativeSchema, 4000);
  return {
    narrative: { headline: data.headline, findings: data.findings.slice(0, 4), nextSteps: data.next_steps.slice(0, 3) },
    usage,
  };
}

export async function draftEmail(params: {
  digest: string;
  facts: string;
  audience: string;
  company: string;
}): Promise<{ subject: string; body: string; usage: LlmUsage }> {
  const task = `Task: Email.\nTo: the ${params.audience}\nFrom: ${params.company}\n\n${params.facts}`;
  const { data, usage } = await sonnet(params.digest, task, EmailSchema, 4000);
  return { subject: data.subject, body: data.body, usage };
}

/** Haiku for short answers: one exception explained, or a free-text question. */
async function haiku(digest: string, messages: Anthropic.MessageParam[]): Promise<{ text: string; usage: LlmUsage }> {
  const client = anthropicClient();
  const response = await client.messages.create({
    model: CHAT_MODEL,
    max_tokens: 2000,
    output_config: { effort: "low" },
    system: systemBlocks(digest) as Anthropic.TextBlockParam[],
    messages,
  });
  const usage = usageOf(CHAT_MODEL, response.usage);
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (response.stop_reason === "refusal" || !text) throw Object.assign(new LlmRefusal("No usable answer"), { usage });
  return { text, usage };
}

export function explainException(digest: string, facts: string) {
  return haiku(digest, [{ role: "user", content: `Task: Explain.\n\n${facts}` }]);
}

/** Earlier turns are appended, never rewritten, so each turn reads the previous ones from cache. */
export function answerQuestion(digest: string, history: { role: "user" | "assistant"; text: string }[], question: string) {
  const messages: Anthropic.MessageParam[] = [];
  for (const h of history) {
    const last = messages[messages.length - 1];
    if (last && last.role === h.role) last.content = `${last.content}\n\n${h.text}`;
    else messages.push({ role: h.role, content: h.text });
  }
  if (messages[0]?.role === "assistant") messages.unshift({ role: "user", content: "(earlier in this chat)" });
  const lastMsg = messages[messages.length - 1];
  const turn = `Task: Question.\n${question}`;
  if (lastMsg?.role === "user") lastMsg.content = `${lastMsg.content}\n\n${turn}`;
  else messages.push({ role: "user", content: turn });
  return haiku(digest, messages);
}
