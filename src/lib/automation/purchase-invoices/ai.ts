import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { anthropicClient } from "@/lib/anthropic";
import type { LlmUsage } from "@/lib/mapping/llm";
import { isoDate, type Draft } from "./draft";

// AI-assisted reading of a supplier invoice (D-69), used only when the rules can't read it
// completely or its figures don't check. Accuracy first: the most capable default model at high
// effort, reading the PDF itself (text and page images, so scans and photos too), asked to copy
// what is printed and never to compute a figure that isn't there. Its answer then goes through
// the same totals checks as a rule-read draft, and is compared field by field with what the
// rules read.

export const EXTRACTION_MODEL = "claude-opus-5-5";

const CACHE = { type: "ephemeral", ttl: "1h" } as const;

/** Byte-stable, so every extraction reads it from cache (D-4). */
export const EXTRACTION_INSTRUCTIONS = `You read supplier tax invoices for e-commerce sellers in the GCC (UAE, Saudi Arabia, Kuwait, Qatar, Bahrain, Oman) and copy their contents into a structured record for review by an accountant.

Rules:
- Copy values exactly as printed. Never compute, estimate or infer a figure that isn't printed: if the invoice shows no VAT amount for a line, that line's vat is null. If a field isn't on the invoice, it is null.
- The supplier (seller) is the party issuing the invoice, not the "Bill to" / buyer. supplier_trn is the supplier's VAT registration number (TRN, 15 digits in the UAE and Saudi Arabia), not the buyer's.
- invoice_number is the supplier's own invoice number, not a PO, delivery note or customer reference.
- Dates as YYYY-MM-DD. GCC invoices write numeric dates day first (03/11/2026 is 3 November 2026) unless the layout clearly says otherwise.
- Amounts as plain numbers in the invoice currency, without thousands separators or currency symbols. Use a negative number only if the invoice prints one.
- currency is the ISO code (AED, SAR, OMR, BHD, KWD, QAR, USD, EUR…). Arabic د.إ is AED, ر.س is SAR.
- One entry in lines per printed line item, in order. Include charges printed as lines (delivery, installation). Leave out subtotal, VAT and total rows. net is the line amount before VAT.
- Read Arabic and English. Where both appear, prefer the English text for descriptions.
- document_type is "credit_note" for a credit note, "debit_note" for a debit note, otherwise "invoice". If the document isn't an invoice at all (a statement, a quotation, a delivery note), set is_invoice to false.
- In notes, mention anything an accountant should check: unreadable figures, handwritten changes, a total that doesn't match the lines, more than one invoice in the document.`;

const Line = z.object({
  description: z.string().nullable(),
  sku: z.string().nullable(),
  quantity: z.number().nullable(),
  unit_price: z.number().nullable(),
  net: z.number().nullable(),
  vat_rate: z.number().nullable(),
  vat: z.number().nullable(),
});

export const ExtractionSchema = z.object({
  is_invoice: z.boolean(),
  document_type: z.enum(["invoice", "credit_note", "debit_note"]),
  supplier_name: z.string().nullable(),
  supplier_trn: z.string().nullable(),
  invoice_number: z.string().nullable(),
  invoice_date: z.string().nullable(),
  due_date: z.string().nullable(),
  currency: z.string().nullable(),
  po_number: z.string().nullable(),
  subtotal: z.number().nullable(),
  vat: z.number().nullable(),
  total: z.number().nullable(),
  lines: z.array(Line),
  notes: z.string().nullable(),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export type AiReading = { extraction: Extraction; model: string; usage: LlmUsage };

/** What capture calls; tests pass a fake, so no test ever calls the API. */
export type AiReader = (pdf: Uint8Array) => Promise<AiReading>;

export class AiReadError extends Error {}

const usageOf = (model: string, u: Anthropic.Beta.BetaUsage): LlmUsage => ({
  model,
  inputTokens: u.input_tokens,
  cacheReadTokens: u.cache_read_input_tokens ?? 0,
  cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  outputTokens: u.output_tokens,
});

/** Reads one invoice PDF with Claude. Throws AiReadError (with usage, when there was a call) if there's no usable answer. */
export const readInvoiceWithAi: AiReader = async (pdf) => {
  const client = anthropicClient();
  const response = await client.beta.messages.parse({
    model: EXTRACTION_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: betaZodOutputFormat(ExtractionSchema) },
    system: [{ type: "text", text: EXTRACTION_INSTRUCTIONS, cache_control: CACHE }],
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(pdf).toString("base64") } },
          { type: "text", text: "Read this supplier invoice." },
        ],
      },
    ],
  });
  const usage = usageOf(response.model, response.usage);
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw Object.assign(new AiReadError("The AI couldn't read this invoice."), { usage });
  }
  return { extraction: response.parsed_output, model: response.model, usage };
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The AI's reading as a draft. Nothing is filled in that the invoice didn't print, except net = qty × price when both are printed. */
export function draftFromExtraction(e: Extraction): Draft {
  const date = (s: string | null) => isoDate(s ?? "") || (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "");
  return {
    supplierName: e.supplier_name?.trim() ?? "",
    supplierTrn: (e.supplier_trn ?? "").replace(/\s/g, ""),
    invoiceNumber: e.invoice_number?.trim() ?? "",
    invoiceDate: date(e.invoice_date),
    dueDate: date(e.due_date),
    currency: (e.currency ?? "").toUpperCase().slice(0, 3),
    poNumber: e.po_number?.trim() ?? "",
    subtotal: e.subtotal,
    vat: e.vat,
    total: e.total,
    vendorNo: "",
    vendorName: "",
    lines: e.lines.map((l) => ({
      description: l.description?.trim() ?? "",
      sku: l.sku?.trim() ?? "",
      qty: l.quantity,
      unitPrice: l.unit_price,
      net: l.net ?? (l.quantity !== null && l.unit_price !== null ? r2(l.quantity * l.unit_price) : null),
      vatRate: l.vat_rate,
      vat: l.vat,
      erpType: null,
      erpNo: "",
    })),
  };
}

const norm = (v: unknown) => (typeof v === "number" ? r2(v).toFixed(2) : String(v ?? "").trim().toUpperCase().replace(/\s+/g, " "));

/**
 * Where the rules and the AI both read a field and disagree, so the reviewer looks at it.
 * Fields one of them left blank aren't conflicts; the draft keeps whichever has a value.
 */
export function compareReadings(rules: Draft, ai: Draft): string[] {
  const out: string[] = [];
  const fields: [keyof Draft, string][] = [
    ["supplierTrn", "Supplier TRN"],
    ["invoiceNumber", "Invoice number"],
    ["invoiceDate", "Invoice date"],
    ["dueDate", "Due date"],
    ["currency", "Currency"],
    ["subtotal", "Net"],
    ["vat", "VAT"],
    ["total", "Total"],
  ];
  for (const [k, label] of fields) {
    const a = rules[k];
    const b = ai[k];
    if (a === null || a === "" || b === null || b === "") continue;
    if (norm(a) !== norm(b)) out.push(`${label}: the text reader read "${a}", the AI read "${b}".`);
  }
  if (rules.lines.length && ai.lines.length && rules.lines.length !== ai.lines.length) {
    out.push(`Lines: the text reader found ${rules.lines.length}, the AI found ${ai.lines.length}.`);
  }
  return out;
}
