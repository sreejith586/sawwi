import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as F from "@/lib/pdf/fixtures/make";
import { answerQuestion, ingestFile, ingestFiles } from "./engine";
import * as store from "./store";
import { buildRunView } from "./view";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sawwi-pdf-test-"));
  process.env.SAWWI_DATA_DIR = dir;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ctx = { countries: ["AE" as const] };

describe("PDF uploads in a run", () => {
  it("maps a PDF bank statement with no questions, and the next one from the same bank reuses layout and mapping", async () => {
    const run = store.createRun("pdf-co", "bank-payouts");
    await ingestFile(run, "bank", "jan.pdf", await F.statementPdf({ opening: 10000, txns: F.JANUARY }), ctx);
    let bank = buildRunView(run.id)!.slots.find((s) => s.key === "bank")!;
    expect(Object.fromEntries(bank.file!.fields.map((f) => [f.key, f.column]))).toMatchObject({
      value_date: "Date",
      description: "Description",
      reference: "Reference",
      credit: "Credit",
      debit: "Debit",
    });
    expect(bank.file!.pdf![0]).toMatchObject({ kind: "statement", layout: "learned" });
    const messages = buildRunView(run.id)!.messages.map((m) => m.body).join("\n");
    expect(messages).toContain("PDF statement; I read it from its text layer, no AI needed");
    expect(messages).toContain("Checks pass");
    // January's dates are all ≤ 12, so the day/month order is the one thing it has to ask.
    const asked = buildRunView(run.id)!.openQuestions;
    expect(asked.map((q) => q.prompt)).toEqual(['How should I read dates in "Date" (e.g. 02/01/2026, 03/01/2026, 05/01/2026)?']);
    answerQuestion(store.getRun(run.id)!, asked[0].id, "DMY");
    expect(buildRunView(run.id)!.status).toBe("collecting");

    const next = store.createRun("pdf-co", "bank-payouts");
    await ingestFile(next, "bank", "feb.pdf", await F.statementPdf({ opening: 13323, txns: F.QUARTER.slice(0, 5) }), ctx);
    bank = buildRunView(next.id)!.slots.find((s) => s.key === "bank")!;
    expect(bank.file!.pdf![0].layout).toBe("remembered");
    expect(bank.file!.remembered).toBe(true);
    expect(buildRunView(next.id)!.openQuestions).toHaveLength(0);
  });

  it("holds the run with a question when a statement's balances don't add up", async () => {
    const run = store.createRun("pdf-co-2", "bank-payouts");
    await ingestFile(run, "bank", "bad.pdf", await F.statementPdf({ opening: 10000, txns: F.JANUARY, misprint: { row: 2, by: -5 } }), ctx);
    let view = buildRunView(run.id)!;
    const q = view.openQuestions[0];
    expect(q.prompt).toMatch(/^bad\.pdf didn't pass a check: .*row 3 shows/);
    expect(q.options.map((o) => o.value)).toEqual(["continue", "replace"]);

    // "I'll upload a corrected file" keeps the question open; "use them" clears it.
    answerQuestion(store.getRun(run.id)!, q.id, "replace");
    view = buildRunView(run.id)!;
    expect(view.openQuestions[0].id).toBe(q.id);
    answerQuestion(store.getRun(run.id)!, q.id, "continue");
    expect(buildRunView(run.id)!.openQuestions.some((o) => o.id === q.id)).toBe(false);
  });

  it("OCRs a scanned statement locally and says so in the chat", async () => {
    const run = store.createRun("pdf-co-4", "bank-payouts");
    await ingestFile(run, "bank", "scan.pdf", await F.statementPdf({ opening: 10000, txns: F.JANUARY, scan: true }), ctx);
    const view = buildRunView(run.id)!;
    const bank = view.slots.find((s) => s.key === "bank")!;
    expect(bank.file!.rowCount).toBe(4);
    expect(bank.file!.pdf![0]).toMatchObject({ method: "ocr", kind: "statement" });
    const chat = view.messages.map((m) => m.body).join("\n");
    expect(chat).toContain("by OCR from its scanned pages, here on the server");
    expect(chat).toContain("It's a scan, so I used OCR");
    expect(view.usage.calls).toBe(0);
  }, 60_000);

  it("reads a batch of supplier invoice PDFs into a line-level slot", async () => {
    const run = store.createRun("pdf-co-3", "p2p-three-way-match");
    const a = await F.invoicePdf({ number: "INV-1", date: "01/01/2026", po: "PO-1", lines: F.MOUSE_LINES.slice(0, 2) });
    const b = await F.invoicePdf({ number: "INV-2", date: "02/01/2026", po: "PO-2", lines: F.MOUSE_LINES.slice(2) });
    await ingestFiles(run, "invoices", [{ name: "a.pdf", data: a }, { name: "b.pdf", data: b }], ctx);
    const slot = buildRunView(run.id)!.slots.find((s) => s.key === "invoices")!;
    expect(slot.file!.name).toBe("a.pdf + 1 more");
    expect(slot.file!.rowCount).toBe(3);
    expect(slot.file!.pdf).toHaveLength(2);
    expect(Object.fromEntries(slot.file!.fields.map((f) => [f.key, f.column]))).toMatchObject({
      invoice_no: "Invoice number",
      po_no: "PO number",
      sku: "SKU",
      qty_invoiced: "Qty",
      line_amount: "Line amount excl. VAT",
    });
  });
});
