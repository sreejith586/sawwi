import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as F from "@/lib/pdf/fixtures/make";
import { listUsageRecords } from "@/lib/runs/store";
import { compareReadings, draftFromExtraction, type AiReader, type Extraction } from "./ai";
import { SAMPLE_SPECS, samplePdf } from "./fixtures/samples";
import * as service from "./service";

// AI-assisted reading (D-69) with a fake reader: no test calls the API.

const env = process.env as Record<string, string | undefined>;
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sawwi-pi-ai-"));
  env.SAWWI_DATA_DIR = dir;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const USAGE = { model: "claude-opus-5-5", inputTokens: 3000, cacheReadTokens: 1200, cacheWriteTokens: 0, outputTokens: 700 };

const extraction = (over: Partial<Extraction> = {}): Extraction => ({
  is_invoice: true,
  document_type: "invoice",
  supplier_name: "Example Trading LLC",
  supplier_trn: "100123456700003",
  invoice_number: "INV-9001",
  invoice_date: "2026-01-15",
  due_date: "2026-02-14",
  currency: "AED",
  po_number: null,
  subtotal: 460,
  vat: 23,
  total: 483,
  lines: [
    { description: "Wireless mouse", sku: "MS-01", quantity: 10, unit_price: 25, net: 250, vat_rate: 5, vat: 12.5 },
    { description: "Keyboard", sku: "KB-02", quantity: 6, unit_price: 35, net: 210, vat_rate: 5, vat: 10.5 },
  ],
  notes: null,
  ...over,
});

/** A fake AI that records its calls. */
function fake(e: Extraction | Error): AiReader & { calls: number } {
  const f = Object.assign(
    async () => {
      f.calls++;
      if (e instanceof Error) throw Object.assign(e, { usage: USAGE });
      return { extraction: e, model: "claude-opus-5-5", usage: USAGE };
    },
    { calls: 0 },
  );
  return f;
}

const LINES = [
  { description: "Wireless mouse", sku: "MS-01", qty: 10, price: 25 },
  { description: "Keyboard", sku: "KB-02", qty: 6, price: 35 },
];

describe("AI-assisted reading (D-69)", () => {
  it("doesn't call the AI when the rules read the invoice completely and it checks", async () => {
    const ai = fake(new Error("must not be called"));
    const { capture } = await service.capturePdf("acme", "u1", { name: "cas.pdf", bytes: await samplePdf(SAMPLE_SPECS[0]) }, { ai });
    expect(ai.calls).toBe(0);
    expect(capture.source.ai).toBeUndefined();
  });

  it("asks the AI when a check fails, keeps its reading, and lists what the two read differently", async () => {
    // VAT printed as 30.00, but 5% of 460 is 23.00: the rules read it and the check fails.
    const pdf = await F.invoicePdf({ number: "INV-9001", date: "15/01/2026", lines: LINES, vatOverride: 30 });
    const ai = fake(extraction({ vat: 30, total: 490 }));
    const { capture } = await service.capturePdf("acme", "u1", { name: "inv-9001.pdf", bytes: pdf }, { ai });
    expect(ai.calls).toBe(1);
    expect(capture.source.ai).toMatchObject({ used: "ai", model: "claude-opus-5-5" });
    expect(capture.source.ai!.reasons.join(" ")).toMatch(/VAT/);
    // The AI's reading still fails the VAT check (the invoice really is wrong): the reviewer sees it.
    const view = (await service.getView("acme", capture.id))!;
    expect(view.status).toBe("needs_review");
    expect(view.review.warnings.join(" ")).toMatch(/Read by AI/);
    const usage = await listUsageRecords("acme");
    expect(usage.at(-1)).toMatchObject({ purpose: "invoice_extraction", orgKey: "acme", runId: null, inputTokens: 3000 });
  });

  it("keeps the rules' reading when the AI's checks worse, and when the AI fails", async () => {
    const pdf = await F.invoicePdf({ number: "INV-9002", date: "15/01/2026", lines: LINES, vatOverride: 30 });
    const worse = fake(extraction({ invoice_number: "INV-9002", total: 999, lines: [] }));
    const a = await service.capturePdf("acme", "u1", { name: "inv-9002.pdf", bytes: pdf }, { ai: worse });
    expect(a.capture.source.ai?.used).toBe("rules");
    expect(a.capture.draft.total).toBe(490);
    expect(a.capture.source.ai?.conflicts).toEqual(expect.arrayContaining([expect.stringMatching(/^Total: the text reader read "490", the AI read "999"/)]));

    const pdf2 = await F.invoicePdf({ number: "INV-9003", date: "15/01/2026", lines: LINES, vatOverride: 30 });
    const broken = fake(new Error("network down"));
    const b = await service.capturePdf("acme", "u1", { name: "inv-9003.pdf", bytes: pdf2 }, { ai: broken });
    expect(b.capture.source.ai).toMatchObject({ used: "rules" });
    expect(b.capture.draft.invoiceNumber).toBe("INV-9003");
  });

  it("reads a PDF the rules can't with the AI alone, and refuses a document that isn't an invoice", async () => {
    const blank = await F.blankScanPdf();
    const ai = fake(extraction({ invoice_number: "INV-7777" }));
    const { capture } = await service.capturePdf("acme", "u1", { name: "photo.pdf", bytes: blank }, { ai });
    expect(capture.draft).toMatchObject({ invoiceNumber: "INV-7777", total: 483 });
    expect(capture.status).toBe("ready");
    expect(capture.issuerKey).toBe("trn:100123456700003");

    const statement = await F.statementPdf({ opening: 1000, txns: F.JANUARY });
    const notInvoice = fake(extraction({ is_invoice: false, notes: "This is a bank statement." }));
    await expect(service.capturePdf("acme", "u1", { name: "stmt.pdf", bytes: statement }, { ai: notInvoice })).rejects.toThrow(/bank statement/);
  });

  it("without the AI, a PDF the rules can't read is refused as before", async () => {
    await expect(service.capturePdf("acme", "u1", { name: "blank2.pdf", bytes: await F.longScanPdf(1) }, { ai: null })).rejects.toThrow();
  });

  it("re-reads a draft with the AI on request and withdraws its approval", async () => {
    const pdf = await samplePdf(SAMPLE_SPECS[1]);
    const { capture } = await service.capturePdf("acme", "u1", { name: "gls.pdf", bytes: pdf }, { ai: null });
    await service.approveMany("acme", [capture.id], "u1");
    const ai = fake(extraction({ supplier_name: "Gulf Lighting Supplies L.L.C.", invoice_number: "GLS-2342", total: 11340, subtotal: 10800, vat: 540, lines: [] }));
    const view = await service.rereadWithAi("acme", capture.id, { ai });
    expect(ai.calls).toBe(1);
    expect(view.status).not.toBe("approved");
    expect(view.source.ai?.reasons).toEqual(["Read again with AI on request."]);
  });

  it("maps an extraction to a draft without inventing figures, and compares field by field", () => {
    const d = draftFromExtraction(extraction({ due_date: null, lines: [{ description: "X", sku: null, quantity: 2, unit_price: 5, net: null, vat_rate: null, vat: null }] }));
    expect(d.dueDate).toBe("");
    expect(d.lines[0]).toMatchObject({ net: 10, vatRate: null, vat: null });
    expect(compareReadings({ ...d, invoiceNumber: "A-1" }, { ...d, invoiceNumber: "a-1" })).toEqual([]);
    expect(compareReadings({ ...d, total: 483 }, { ...d, total: 438 })).toEqual(['Total: the text reader read "483", the AI read "438".']);
  });
});
