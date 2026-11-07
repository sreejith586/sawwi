import { isDemoOrg } from "@/lib/demo/demo";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ColumnProfile } from "@/lib/files/profile";
import { TEMPLATES } from "@/lib/templates/catalog";
import type { CanonicalField } from "@/lib/templates/types";

// Light model for column mapping: it reads headers and a few sample values, never whole files.
export const MAPPING_MODEL = "claude-haiku-5-5";

export type LlmUsage = {
  model: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
};

export type LlmSuggestion = { field: string; column: string | null; confidence: number };

const MappingSchema = z.object({
  mappings: z.array(
    z.object({
      field: z.string(),
      column: z.string().nullable(),
      confidence: z.number(),
    }),
  ),
});

/** The demo store never calls the AI (D-32): visitors can't run up token costs, rule-based text is used instead. */
export function llmAvailable(orgKey?: string): boolean {
  if (isDemoOrg(orgKey)) return false;
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/**
 * Glossary of every canonical field across all templates, in a fixed order.
 * It is identical for every request, so it sits in the cached system prefix and
 * the cache is shared across templates, files and customers' repeat runs.
 */
function buildGlossary(): string {
  const fields = new Map<string, CanonicalField>();
  for (const t of TEMPLATES) for (const s of t.sources) for (const f of s.fields) if (!fields.has(f.key)) fields.set(f.key, f);
  return [...fields.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((f) => `- ${f.key} (${f.type}): ${f.label}`)
    .join("\n");
}

const SYSTEM_INSTRUCTIONS = `You map columns from a finance or operations export file onto Sawwi's canonical fields. Sawwi is a reconciliation tool for e-commerce sellers in the GCC: marketplace sellers (Amazon, Noon, Namshi and others), webstores (Shopify, Magento 1 and 2, WooCommerce, Salla, Zid) and companies selling directly to businesses. Files come from marketplaces, payment gateways, BNPL providers, couriers, banks and ERPs (Odoo, Zoho Books, SAP Business One, Dynamics, NetSuite, QuickBooks, Tally). Headers may be in English or Arabic, abbreviated, or vendor-specific.

You will receive the canonical fields that still need a column, and a profile of every column in the file: its header, inferred kind (number, date, id, text, empty), fill rate and up to five sample values.

Rules:
- Return one entry per requested field, in the order given.
- "column" must be copied exactly from the provided headers, or null if no column fits. Never invent a header.
- Use one column for at most one field.
- Judge by both the header and the sample values. A money field needs numeric values; a date field needs dates; an id field needs identifier-like values.
- "confidence" is 0 to 1: 0.9 or more only when header and samples clearly agree; 0.5 to 0.8 when plausible but uncertain; below 0.5 means you are guessing, so prefer null.
- Amounts that include VAT, net payouts and gross sales are different things. Do not map a net payout column to a gross or principal field.
- Do not explain. Output only the structured result.

Canonical field glossary (key, type, meaning):
`;

const SYSTEM_PROMPT = SYSTEM_INSTRUCTIONS + buildGlossary();

function describeColumns(columns: ColumnProfile[]): string {
  return columns
    .map((c) => {
      const samples = c.samples.map((s) => JSON.stringify(s.slice(0, 40))).join(", ");
      return `- ${JSON.stringify(c.name)} | ${c.kind}${c.dateFormat ? ` ${c.dateFormat}` : ""} | fill ${Math.round(c.fillRate * 100)}% | ${samples}`;
    })
    .join("\n");
}

export async function suggestMappings(params: {
  sourceLabel: string;
  fields: CanonicalField[];
  columns: ColumnProfile[];
}): Promise<{ suggestions: LlmSuggestion[]; usage: LlmUsage }> {
  const client = new Anthropic();
  const fieldList = params.fields.map((f) => `- ${f.key} (${f.type}${f.required ? ", required" : ""}): ${f.label}`).join("\n");

  const response = await client.messages.parse({
    model: MAPPING_MODEL,
    max_tokens: 2000,
    output_config: { effort: "low", format: zodOutputFormat(MappingSchema) },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral", ttl: "1h" } }],
    messages: [
      {
        role: "user",
        content: `File type: ${params.sourceLabel}\n\nFields to map:\n${fieldList}\n\nColumns in the file:\n${describeColumns(params.columns)}`,
      },
    ],
  });

  const usage: LlmUsage = {
    model: MAPPING_MODEL,
    inputTokens: response.usage.input_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    outputTokens: response.usage.output_tokens,
  };

  if (response.stop_reason === "refusal" || !response.parsed_output) return { suggestions: [], usage };

  // Validate against what we actually sent; drop anything invented.
  const headers = new Set(params.columns.map((c) => c.name));
  const wanted = new Set(params.fields.map((f) => f.key));
  const suggestions = response.parsed_output.mappings
    .filter((m) => wanted.has(m.field))
    .map((m) => ({
      field: m.field,
      column: m.column && headers.has(m.column) ? m.column : null,
      confidence: Math.max(0, Math.min(1, m.confidence)),
    }));
  return { suggestions, usage };
}
