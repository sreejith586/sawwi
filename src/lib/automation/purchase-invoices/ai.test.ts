import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as F from "@/lib/pdf/fixtures/make";
import { listUsageRecords } from "@/lib/runs/store";
import { z } from "zod";
import { AiReadError, compareReadings, draftFromExtraction, ExtractionSchema, type AiReader, type Extraction } from "./ai";
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
  po_number: "",
  subtotal: 460,
  vat: 23,
  total: 483,
  lines: [
    { description: "Wireless mouse", sku: "MS-01", quantity: 10, unit_price: 25, net: 250, vat_rate: 5, vat: 12.5 },
    { description: "Keyboard", sku: "KB-02", quantity: 6, unit_price: 35, net: 210, vat_rate: 5, vat: 10.5 },
  ],
  notes: "",
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
    // Kept as "failed" with the reason, for a person to retry or type in (D-86).
    const refused = await service.capturePdf("acme", "u1", { name: "stmt.pdf", bytes: statement }, { ai: notInvoice });
    expect(refused).toMatchObject({ failed: true, capture: { status: "failed", failure: { stage: "read", message: expect.stringMatching(/bank statement/), attempts: 1 } } });
  });

  it("sends a scan to the AI without OCR, and OCRs it only when the AI can't read it (D-100)", async () => {
    const scan = await F.invoicePdf({ number: "INV-2026-0042", date: "15/01/2026", po: "PO-7781", lines: F.MOUSE_LINES, scan: true });
    const ai = fake(extraction({ invoice_number: "INV-2026-0042" }));
    const { capture } = await service.capturePdf("scans", "u1", { name: "scan.pdf", bytes: scan }, { ai });
    expect(ai.calls).toBe(1);
    expect(capture.draft.invoiceNumber).toBe("INV-2026-0042");
    expect(capture.source).toMatchObject({ method: "ocr", pages: 1, ai: { used: "ai", reasons: ["It's a scan: read by AI directly."] } });
    expect(capture.source.ocr).toBeUndefined(); // never OCR'd

    // The AI fails: the scan is OCR'd after all and the text reader's reading is kept.
    const broken = fake(new AiReadError("no answer"));
    const other = await F.invoicePdf({ number: "INV-2026-0043", date: "15/01/2026", lines: F.MOUSE_LINES, scan: true });
    const fallback = await service.capturePdf("scans", "u1", { name: "scan2.pdf", bytes: other }, { ai: broken });
    expect(broken.calls).toBe(1);
    expect(fallback.capture).toMatchObject({ status: "ready", draft: { invoiceNumber: "INV-2026-0043" }, source: { method: "ocr", ai: { used: "rules" } } });
    expect(fallback.capture.source.ocr?.pages).toBe(1);
  }, 120_000);

  it("without the AI, a PDF the rules can't read waits under Failed; a retry or the same upload reads it again (D-86)", async () => {
    const bytes = await F.longScanPdf(1);
    const { capture, failed } = await service.capturePdf("acme", "u1", { name: "blank2.pdf", bytes }, { ai: null });
    expect(failed).toBe(true);
    expect(capture).toMatchObject({ status: "failed", draft: { invoiceNumber: "blank2", lines: [] } });
    expect((await service.approveMany("acme", [capture.id], "u1"))[0]).toMatchObject({ ok: false, message: expect.stringContaining("couldn't be read") });
    // Retry with the AI on: it reads now and joins the review queue; the failure is cleared.
    const ai = fake(extraction({ invoice_number: "INV-8888" }));
    const again = await service.retryRead("acme", capture.id, { ai });
    expect(again).toMatchObject({ status: "ready", failure: null, draft: { invoiceNumber: "INV-8888" } });
  });

  it("counts failed attempts, and a typed-in draft leaves Failed", async () => {
    const bytes = await F.longScanPdf(2);
    const { capture } = await service.capturePdf("acme", "u1", { name: "blank3.pdf", bytes }, { ai: null });
    const second = await service.capturePdf("acme", "u1", { name: "blank3.pdf", bytes }, { ai: null });
    expect(second).toMatchObject({ existing: true, failed: true, capture: { failure: { attempts: 2 } } });
    const typed = { ...capture.draft, supplierName: "Typed Supplier", invoiceDate: "2026-11-20", subtotal: 100, vat: 15, total: 115, lines: [{ description: "Goods", sku: "", qty: 1, unitPrice: 100, net: 100, vatRate: 15, vat: 15, erpType: null, erpNo: "" }] };
    const saved = await service.saveEdits("acme", capture.id, typed);
    expect(saved).toMatchObject({ status: "ready", failure: null });
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

  it("reads a PDF with AI once: deleting and uploading it again reuses the reading at no cost (D-89)", async () => {
    const pdf = await F.invoicePdf({ number: "INV-9101", date: "15/01/2026", lines: LINES, vatOverride: 30 });
    const ai = fake(extraction({ invoice_number: "INV-9101", vat: 30, total: 490 }));
    const first = await service.capturePdf("spend", "u1", { name: "inv-9101.pdf", bytes: pdf }, { ai });
    expect(ai.calls).toBe(1);
    await service.discard("spend", first.capture.id);
    const again = await service.capturePdf("spend", "u1", { name: "copy-of-9101.pdf", bytes: pdf }, { ai });
    expect(ai.calls).toBe(1);
    expect(again.capture).toMatchObject({ draft: { invoiceNumber: "INV-9101" }, source: { ai: { used: "ai", reusedFrom: expect.any(String) } } });
    expect((await service.getView("spend", again.capture.id))!.review.warnings).toContainEqual(expect.stringContaining("was reused: no new AI cost"));
    expect((await listUsageRecords("spend")).length).toBe(1);
    // Another workspace's upload of the same PDF is read for that workspace: readings aren't shared.
    await service.capturePdf("other-co", "u1", { name: "inv-9101.pdf", bytes: pdf }, { ai });
    expect(ai.calls).toBe(2);
  });

  it("allows one paid “Read again with AI” per PDF, then refuses (D-89)", async () => {
    const pdf = await F.invoicePdf({ number: "INV-9102", date: "15/01/2026", lines: LINES, vatOverride: 30 });
    const ai = fake(extraction({ invoice_number: "INV-9102", vat: 30, total: 490 }));
    const { capture } = await service.capturePdf("spend", "u1", { name: "inv-9102.pdf", bytes: pdf }, { ai });
    await service.rereadWithAi("spend", capture.id, { ai });
    expect(ai.calls).toBe(2);
    await expect(service.rereadWithAi("spend", capture.id, { ai })).rejects.toThrow(/already read by AI 2 times/);
    expect(ai.calls).toBe(2);
  });

  it("stops after a paid call that gave nothing usable, and at the workspace's daily cap (D-89)", async () => {
    const pdf = await F.longScanPdf(3);
    const refusing = fake(new AiReadError("refused"));
    const { capture } = await service.capturePdf("capped", "u1", { name: "scan.pdf", bytes: pdf }, { ai: refusing });
    expect(capture.status).toBe("failed");
    await service.retryRead("capped", capture.id, { ai: refusing });
    expect(refusing.calls).toBe(2);
    const third = await service.retryRead("capped", capture.id, { ai: refusing });
    expect(refusing.calls).toBe(2);
    expect(third.failure?.message).toMatch(/already read by AI 2 times/);

    const env = process.env as Record<string, string | undefined>;
    env.SAWWI_AI_INVOICES_PER_DAY = "2";
    try {
      const ai = fake(extraction({ invoice_number: "INV-9103" }));
      const capped = await service.capturePdf("capped", "u1", { name: "blank.pdf", bytes: await F.longScanPdf(4) }, { ai });
      expect(ai.calls).toBe(0);
      expect(capped.capture.failure?.message).toMatch(/used its 2 AI invoice readings for the last 24 hours/);
    } finally {
      delete env.SAWWI_AI_INVOICES_PER_DAY;
    }
  });

  it("keeps the schema within the API's limit of 16 nullable (union-typed) parameters", () => {
    let unions = 0;
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const o = node as Record<string, unknown>;
      if (o.properties && typeof o.properties === "object") {
        for (const prop of Object.values(o.properties as Record<string, Record<string, unknown>>)) {
          if (Array.isArray(prop.type) || Array.isArray(prop.anyOf)) unions++;
        }
      }
      for (const v of Object.values(o)) walk(v);
    };
    walk(z.toJSONSchema(ExtractionSchema));
    expect(unions).toBeGreaterThan(0);
    expect(unions).toBeLessThanOrEqual(16);
  });

  it("maps an extraction to a draft without inventing figures, and compares field by field", () => {
    const d = draftFromExtraction(extraction({ due_date: "", lines: [{ description: "X", sku: "", quantity: 2, unit_price: 5, net: null, vat_rate: null, vat: null }] }));
    expect(d.dueDate).toBe("");
    expect(d.lines[0]).toMatchObject({ net: 10, vatRate: null, vat: null });
    expect(compareReadings({ ...d, invoiceNumber: "A-1" }, { ...d, invoiceNumber: "a-1" })).toEqual([]);
    expect(compareReadings({ ...d, total: 483 }, { ...d, total: 438 })).toEqual(['Total: the text reader read "483", the AI read "438".']);
  });
});
