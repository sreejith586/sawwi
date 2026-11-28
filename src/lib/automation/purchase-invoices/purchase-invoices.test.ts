import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Papa from "papaparse";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bcOpenOrderLines, bcPrepareOrderInvoice, bcPurchaseInvoices, bcReceipts } from "@/lib/connectors/business-central";
import { DEMO_BC_CREDENTIALS, mockBusinessCentral } from "@/lib/connectors/mock/business-central";
import { demoDeps, resetDemoErpWrites } from "@/lib/connectors/mock";
import { ConnectorError, type ConnectorDeps, type ErpOpenOrderLine, type ErpReceipt } from "@/lib/connectors/types";
import { capturesWorkbook } from "./excel";
import { candidatesFor, grnOptionsFor, matchOrders, orderPlan, pickGrn, pickOrderLine } from "./orders";
import ExcelJS from "exceljs";
import { DEMO_ORG_KEY } from "@/lib/demo/demo";
import { readStoredFile } from "@/lib/files/storage";
import { cleanSku, CSV_HEADERS, csvRows, draftFromInvoice, isGtin, isoDate, normInvoiceNo, reviewDraft, sanitizeDraft, type Draft } from "./draft";
import { SAMPLE_SPECS, sampleJpeg, samplePdf } from "./fixtures/samples";
import { jpegsToPdf, jpegToPdf } from "./photo-pdf";
import { extractPdf } from "@/lib/pdf";
import { learnFromDraft, matchLine, matchVendor, normName, type MasterData } from "./matching";
import { SAMPLE_PDFS } from "./samples-data";
import * as service from "./service";

// Purchase invoice capture (D-60–D-66), end to end against the mock Business Central. All
// suppliers, TRNs and numbers are invented; nothing leaves the process.

const env = process.env as Record<string, string | undefined>;
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sawwi-pi-"));
  env.SAWWI_DATA_DIR = dir;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ORG = DEMO_ORG_KEY;
const USER = "user-1";

describe("item codes stay clean: the barcode is the ERP reference (D-89)", () => {
  it("keeps only the code, moves other text to the description, and checks barcodes", () => {
    expect(cleanSku("3607342306134 بيوتي")).toEqual({ code: "3607342306134", rest: "بيوتي" });
    expect(cleanSku("بردايس MS sigs 3614220940991")).toEqual({ code: "3614220940991", rest: "بردايس MS sigs" });
    expect(cleanSku("٣٦١٤٢٧٢٠٥٠٣٥٨")).toEqual({ code: "3614272050358", rest: "" });
    expect(cleanSku("3614 2737 60652")).toMatchObject({ code: "3614273760652" });
    expect(cleanSku("GL-LED40")).toEqual({ code: "GL-LED40", rest: "" });
    // Alphanumeric codes stay whole: a digit run inside one is never cut out of it.
    expect(cleanSku("AB12345678 عطر")).toEqual({ code: "AB12345678", rest: "عطر" });
    expect(cleanSku("PRF-3614272050358")).toEqual({ code: "PRF-3614272050358", rest: "" });
    expect(cleanSku("بيوتي")).toEqual({ code: "", rest: "بيوتي" });
    expect(isGtin("3607342306134")).toBe(true);
    expect(isGtin("3607342306135")).toBe(false);
    expect(isGtin("088300049479")).toBe(true);
    expect(isGtin("917")).toBe(false);
    const d = draftFromInvoice({ lines: [{ sku: "3607342306134 بيوتي", description: "1480 Ti", qty: 8, unitPrice: 76 }] } as never);
    expect(d.lines[0]).toMatchObject({ sku: "3607342306134", description: "بيوتي 1480 Ti" });
    expect(sanitizeDraft({ ...d, lines: [{ ...d.lines[0], sku: "3607342306134 بيوتي" }] })!.lines[0].sku).toBe("3607342306134");
  });

  it("warns on a line whose code isn't a valid barcode when the supplier uses barcodes", () => {
    const line = (sku: string) => ({ description: "x", sku, qty: 1, unitPrice: 1, net: 1, vatRate: null, vat: null, erpType: null, erpNo: "" });
    const d = { supplierName: "S", supplierTrn: "3", invoiceNumber: "1", invoiceDate: "2026-11-17", dueDate: "", currency: "SAR", poNumber: "", subtotal: 3, vat: null, total: 3, vendorNo: "", vendorName: "", lines: [line("3607342306134"), line("3607342306135"), line("088300049479")] };
    expect(reviewDraft(d, { erp: false }).warnings).toEqual(expect.arrayContaining([expect.stringContaining("Line 2: item code 3607342306135 isn't a valid barcode")]));
  });
});

describe("draft model", () => {
  it("reads printed dates day first, as ISO", () => {
    expect(isoDate("28/10/2026")).toBe("2026-10-28");
    expect(isoDate("2026-11-02")).toBe("2026-11-02");
    expect(isoDate("2 Nov 2026")).toBe("2026-11-02");
    expect(isoDate("31/02/2026")).toBe("");
    expect(isoDate("")).toBe("");
  });

  it("treats spacing, dashes and leading zeros as the same invoice number", () => {
    expect(normInvoiceNo("gls-2307")).toBe(normInvoiceNo("GLS 2307"));
    expect(normInvoiceNo("000419")).toBe("419");
  });

  it("blocks approval on failed totals, missing fields and, with an ERP, uncoded lines", () => {
    const d: Draft = {
      supplierName: "X", supplierTrn: "", invoiceNumber: "", invoiceDate: "2026-10-01", dueDate: "", currency: "AED", poNumber: "",
      subtotal: 100, vat: 5, total: 106, vendorNo: "", vendorName: "",
      lines: [{ description: "A", sku: "", qty: 1, unitPrice: 100, net: 100, vatRate: 5, vat: 5, erpType: null, erpNo: "" }],
    };
    expect(reviewDraft(d, { erp: false }).blockers).toEqual([expect.stringContaining("total is AED 106.00"), "The supplier's invoice number is missing."]);
    expect(reviewDraft({ ...d, invoiceNumber: "1", total: 105 }, { erp: false }).blockers).toEqual([]);
    expect(reviewDraft({ ...d, invoiceNumber: "1", total: 105 }, { erp: true }).blockers).toEqual([
      "Pick the Business Central vendor for this supplier.",
      'Line 1 ("A") needs an item or G/L account.',
    ]);
  });

  it("cleans what the browser sends and hashes content with its target", () => {
    const clean = sanitizeDraft({ invoiceNumber: " X-1 ", invoiceDate: "2026-13-01", total: "1,050.5", extra: "dropped", lines: [{ qty: "2", erpType: "bogus", erpNo: "9" }] })!;
    expect(clean.invoiceNumber).toBe("X-1");
    expect(clean.invoiceDate).toBe("");
    expect(clean.total).toBe(1050.5);
    expect(clean.lines[0]).toMatchObject({ qty: 2, erpType: null, erpNo: "" });
    expect("extra" in clean).toBe(false);
    expect(service.draftHash(clean, "a")).not.toBe(service.draftHash(clean, "b"));
  });
});

describe("phone photos (D-67)", () => {
  it("a photo wrapped as a one-page JPEG PDF is read like a scan", async () => {
    const spec = SAMPLE_SPECS.find((s) => s.id === "coolbreeze-cas-55188")!;
    const { jpeg, width, height } = await sampleJpeg(spec);
    const pdf = jpegToPdf(jpeg, width, height);
    expect(new TextDecoder().decode(pdf.slice(0, 8))).toBe("%PDF-1.4");
    const t = await extractPdf("photo.pdf", pdf, { grain: "line" });
    expect(t.info.method).toBe("ocr");
    expect(t.invoice).toMatchObject({ number: "CAS-55188", sellerVat: "100234567800003", total: 12862.5 });
    expect(t.invoice!.lines.map((l) => l.sku)).toContain("AC-18K");
  }, 60_000);

  it("photos of several pages become one invoice PDF, pages in order", async () => {
    // A cover page with no invoice number, then the invoice: totals come from the last page, as on paper.
    const cover = await sampleJpeg({ ...SAMPLE_SPECS[0], supplier: "", address: "", trn: "", number: "", lines: [] });
    const invoice = await sampleJpeg(SAMPLE_SPECS.find((s) => s.id === "gulf-lighting-gls-2342")!);
    const t = await extractPdf("photos.pdf", jpegsToPdf([cover, invoice]), { grain: "line" });
    expect(t.info).toMatchObject({ method: "ocr", pages: 2 });
    expect(t.invoice).toMatchObject({ number: "GLS-2342", total: 11340 });
  }, 90_000);

  it("refuses bytes that aren't a JPEG", () => {
    expect(() => jpegToPdf(new Uint8Array([0x89, 0x50]), 1, 1)).toThrow(/JPEG/);
  });
});

describe("samples", () => {
  it("the bundled sample PDFs are what the fixture draws (re-run the script if this fails)", async () => {
    for (const spec of SAMPLE_SPECS) expect(Buffer.from(await samplePdf(spec)).toString("base64"), spec.id).toBe(SAMPLE_PDFS[spec.id]);
  });
});

const MD: MasterData = {
  company: "Co", lcy: "AED", fetchedAt: "",
  vendors: [
    { number: "V1", name: "Gulf Lighting Supplies", trn: "100345678900003", currency: "" },
    { number: "V2", name: "Al Noor Packaging Materials", trn: "", currency: "" },
    { number: "V3", name: "Al Noor Packaging Materials Co", trn: "", currency: "" },
  ],
  items: [
    { number: "LED-40", name: "LED panel 40 W", gtin: "6291234567890" },
    { number: "FAN-1200", name: "Ceiling fan 1200 mm", gtin: "" },
  ],
  accounts: [{ number: "5410", name: "Freight" }],
};
const draft = (over: Partial<Draft>): Draft => ({ supplierName: "", supplierTrn: "", invoiceNumber: "", invoiceDate: "", dueDate: "", currency: "", poNumber: "", subtotal: null, vat: null, total: null, vendorNo: "", vendorName: "", lines: [], ...over });
const line = (sku: string, description: string) => ({ sku, description, qty: 1, unitPrice: 1, net: 1, vatRate: 5, vat: 0.05, erpType: null, erpNo: "" });

describe("matching (D-62)", () => {
  it("matches the vendor by TRN, then by exact normalised name, never by a guess", () => {
    expect(normName("Gulf Lighting Supplies L.L.C.")).toBe("gulf lighting supplies");
    expect(matchVendor(draft({ supplierTrn: "100345678900003", supplierName: "Whoever" }), MD)?.vendor.number).toBe("V1");
    expect(matchVendor(draft({ supplierName: "GULF LIGHTING SUPPLIES LLC" }), MD)).toMatchObject({ vendor: { number: "V1" }, by: "name" });
    // Two vendors normalise to the same name: ambiguous, so the user picks.
    expect(matchVendor(draft({ supplierName: "Al Noor Packaging Materials Trading LLC" }), MD)).toBeUndefined();
    expect(matchVendor(draft({ supplierName: "Gulf Lights" }), MD)).toBeUndefined();
  });

  it("matches lines by SKU, GTIN, exact name, then memory first", () => {
    expect(matchLine(line("led-40", ""), MD)).toEqual({ type: "item", no: "LED-40", by: "sku" });
    expect(matchLine(line("6291234567890", ""), MD)).toEqual({ type: "item", no: "LED-40", by: "gtin" });
    expect(matchLine(line("GL-LED40", "LED Panel 40W"), MD)).toBeUndefined();
    expect(matchLine(line("GL-LED40", "LED panel, 40 W"), MD)).toEqual({ type: "item", no: "LED-40", by: "name" });
    const profile = learnFromDraft(undefined, "issuer", draft({ lines: [{ ...line("GL-FAN12", "Ceiling fan 1200mm"), erpType: "item", erpNo: "FAN-1200" }], invoiceDate: "2026-11-01", dueDate: "2026-12-01" }), () => 30);
    expect(profile.termsDays).toBe(30);
    expect(matchLine(line("GL-FAN12", "anything"), MD, profile)).toEqual({ type: "item", no: "FAN-1200", by: "memory" });
  });
});

describe("Business Central writes (D-64)", () => {
  const sleep = async () => {};
  const inv = { vendorNumber: "V0001", vendorInvoiceNumber: "T-1", invoiceDate: "2026-11-01", dueDate: "", currency: "AED", lines: [{ type: "item" as const, number: "AC-18K", description: "", quantity: 2, directUnitCost: 100 }] };

  it("creates a draft with lines, reads BC's total back, and finds it as a duplicate", async () => {
    const writes = new Map<string, Record<string, unknown>[]>();
    const log: { method: string; url: string; body?: string }[] = [];
    const deps: ConnectorDeps = { fetch: mockBusinessCentral({ writes, log }), sleep };
    const created = await bcPurchaseInvoices.createDraft(DEMO_BC_CREDENTIALS, inv, deps);
    expect(created).toMatchObject({ status: "Draft", company: "Sawwi Demo Trading LLC", totalIncludingTax: 210 });
    const header = JSON.parse(log.find((l) => l.method === "POST" && l.url.endsWith("/purchaseInvoices"))!.body!);
    // LCY documents carry no currency code; no posting, no other document touched.
    expect(header).toEqual({ vendorNumber: "V0001", vendorInvoiceNumber: "T-1", invoiceDate: "2026-11-01" });
    expect(log.filter((l) => l.method !== "GET" && !l.url.includes("login.")).map((l) => l.url.split("/").pop())).toEqual([expect.stringMatching(/^purchaseInvoices$/), "purchaseInvoiceLines"]);
    expect(await bcPurchaseInvoices.findExisting(DEMO_BC_CREDENTIALS, "V0001", "T-1", deps)).toEqual([{ id: created.id, number: created.number, status: "Draft" }]);
    expect(await bcPurchaseInvoices.findExisting(DEMO_BC_CREDENTIALS, "V0002", "GLS-2307", deps)).toMatchObject([{ number: "PI-9003" }]);
  });

  it("deletes its own half-made draft when a line fails", async () => {
    const writes = new Map<string, Record<string, unknown>[]>();
    const deps: ConnectorDeps = { fetch: mockBusinessCentral({ writes }), sleep };
    await expect(bcPurchaseInvoices.createDraft(DEMO_BC_CREDENTIALS, { ...inv, lines: [{ ...inv.lines[0], number: "NOPE" }] }, deps)).rejects.toThrow(/Item does not exist/);
    expect([...writes.values()].flat()).toEqual([]);
  });

  it("says which permission set to add when the app is read-only", async () => {
    const deps: ConnectorDeps = { fetch: mockBusinessCentral({ readOnly: true }), sleep };
    await expect(bcPurchaseInvoices.createDraft(DEMO_BC_CREDENTIALS, inv, deps)).rejects.toThrow(/D365 PURCH DOC, EDIT/);
  });

  it("writes only to the Business Central host", async () => {
    const deps: ConnectorDeps = { fetch: mockBusinessCentral(), sleep };
    const evil = { ...DEMO_BC_CREDENTIALS, tenantId: "x" };
    await expect(bcPurchaseInvoices.createDraft(evil, inv, deps)).rejects.toBeInstanceOf(ConnectorError);
  });
});

describe("capture → review → approve → push, in the demo store", () => {
  beforeAll(() => resetDemoErpWrites());
  const sample = (id: string) => service.captureSample(ORG, USER, id, { countries: ["AE"] });

  it("reads a sample, matches vendor and SKU, keeps the PDF, and opens the same file again instead of duplicating it", async () => {
    const { capture: c, existing } = await sample("coolbreeze-cas-55188");
    expect(existing).toBe(false);
    expect(c.draft).toMatchObject({ vendorNo: "V0001", vendorMatchedBy: "trn", invoiceNumber: "CAS-55188", invoiceDate: "2026-10-28", dueDate: "2026-11-27", total: 12862.5 });
    expect(c.draft.lines.map((l) => [l.erpType, l.erpNo, l.matchedBy])).toEqual([["item", "AC-18K", "sku"], [null, "", undefined]]);
    expect(c.status).toBe("needs_review");
    expect((await readStoredFile(c.storedPath!))?.length).toBeGreaterThan(1000);
    expect((await sample("coolbreeze-cas-55188")).existing).toBe(true);
  });

  it("approves only what has nothing blocking it; an edit withdraws the approval", async () => {
    const [c] = (await service.listViews(ORG)).filter((v) => v.draft.invoiceNumber === "CAS-55188");
    expect(await service.approveMany(ORG, [c.id], USER)).toEqual([{ id: c.id, ok: false, message: expect.stringContaining("needs an item or G/L account") }]);
    const coded = { ...c.draft, lines: c.draft.lines.map((l, i) => (i === 1 ? { ...l, erpType: "account" as const, erpNo: "5410", matchedBy: "user" as const } : l)) };
    expect((await service.saveEdits(ORG, c.id, coded)).status).toBe("ready");
    expect(await service.approveMany(ORG, [c.id], USER)).toEqual([{ id: c.id, ok: true }]);
    expect((await service.saveEdits(ORG, c.id, { ...coded, poNumber: "PO-7004 " })).status).toBe("ready");
    expect((await service.approveMany(ORG, [c.id], USER))[0].ok).toBe(true);
  });

  it("pushes only with the confirmed hash, once, and records the BC draft", async () => {
    const [c] = (await service.listViews(ORG)).filter((v) => v.draft.invoiceNumber === "CAS-55188");
    expect((await service.pushMany(ORG, [{ id: c.id, hash: "stale" }], USER))[0]).toMatchObject({ ok: false, message: expect.stringContaining("changed after you confirmed") });
    const [pushed] = await service.pushMany(ORG, [{ id: c.id, hash: c.hash }], USER);
    expect(pushed).toMatchObject({ ok: true, message: expect.stringMatching(/^CAS-55188 is draft PI-\d+ in Sawwi Demo Trading LLC\.$/) });
    const after = (await service.getView(ORG, c.id))!;
    expect(after.status).toBe("pushed");
    expect(after.erp).toMatchObject({ company: "Sawwi Demo Trading LLC", erpTotal: 12862.5, pushedBy: USER });
    expect((await service.pushMany(ORG, [{ id: c.id, hash: c.hash }], USER))[0].ok).toBe(false);
    await expect(service.saveEdits(ORG, c.id, c.draft)).rejects.toThrow(/can't be changed/);
  });

  it("refuses an invoice Business Central already has", async () => {
    const { capture: c } = await sample("gulf-lighting-gls-2307");
    expect(c.draft).toMatchObject({ vendorNo: "V0002", vendorMatchedBy: "trn" });
    expect(c.draft.lines[0]).toMatchObject({ erpNo: "LED-40", matchedBy: "name" });
    expect(await service.erpDuplicates(ORG, c.draft)).toMatchObject([{ number: "PI-9003" }]);
    // No PO printed: Sawwi suggests PO-7002 for the LED panels; the reviewer confirms it.
    expect(c.draft).toMatchObject({ postTo: "order", lines: [{ po: { orderNumber: "PO-7002" } }] });
    expect(c.draft.poConfirmed).toBeUndefined();
    await service.saveEdits(ORG, c.id, { ...c.draft, poConfirmed: true });
    await service.approveMany(ORG, [c.id], USER);
    const v = (await service.getView(ORG, c.id))!;
    expect((await service.pushMany(ORG, [{ id: c.id, hash: v.hash }], USER))[0]).toMatchObject({ ok: false, message: expect.stringContaining("already in Business Central as PI-9003") });
    expect((await service.getView(ORG, c.id))!.status).toBe("approved");
  });

  it("remembers a supplier's item codes and layout from a pushed invoice", async () => {
    const { capture: c } = await sample("gulf-lighting-gls-2342");
    expect(c.source.layout).toBe("remembered"); // GLS-2307 taught the layout
    expect(c.draft.lines.map((l) => l.erpNo)).toEqual(["LED-40", ""]);
    // The LED panels were received on PO-7002 (D-88); the fan isn't on an open order. Sawwi blocks
    // a standalone invoice for goods already received until the user chooses one.
    expect(c.draft.lines[0].po).toMatchObject({ orderNumber: "PO-7002", receipts: ["PRC-8002"], open: 500 });
    const coded = { ...c.draft, lines: c.draft.lines.map((l, i) => (i === 1 ? { ...l, erpType: "item" as const, erpNo: "FAN-1200", matchedBy: "user" as const } : l)) };
    const blocked = await service.saveEdits(ORG, c.id, coded);
    expect(blocked.review.blockers).toEqual([expect.stringContaining("was received on PO-7002 (GRN PRC-8002)")]);
    await service.saveEdits(ORG, c.id, { ...coded, postTo: "invoice" });
    await service.approveMany(ORG, [c.id], USER);
    const v = (await service.getView(ORG, c.id))!;
    expect((await service.pushMany(ORG, [{ id: c.id, hash: v.hash }], USER))[0].ok).toBe(true);
    // The rejected GLS-2307 draft now matches the fan code from memory if it had one; a new
    // Gulf invoice with GL-FAN12 would too:
    const { matchLine: ml } = await import("./matching");
    const md = (await service.masterData(ORG, "demo:business-central"))!;
    const { getProfile } = await import("./store");
    const profile = await getProfile(ORG, c.issuerKey, c.draft.supplierTrn);
    expect(ml(c.draft.lines[1], md, profile)).toEqual({ type: "item", no: "FAN-1200", by: "memory" });
  });

  it("invoices GLS-2360 against PO-7002 and its GRN: sets the order line up, refuses a second invoice on it (D-88)", async () => {
    const { capture: c } = await sample("gulf-lighting-gls-2360");
    // The PO number is printed and the order agrees, so the match needs no confirmation.
    expect(c.draft).toMatchObject({ vendorNo: "V0002", poNumber: "PO-7002", postTo: "order", poConfirmed: true });
    expect(c.draft.lines[0]).toMatchObject({ erpNo: "LED-40", qty: 300, po: { orderNumber: "PO-7002", receipts: ["PRC-8002"], open: 500, poPrice: 22 }, grn: { number: "PRC-8002", orderNumber: "PO-7002", quantity: 500 } });
    // The GRN received 500, the invoice bills 300: a partial invoice, worth a look but not a blocker (D-92).
    expect((await service.getView(ORG, c.id))!.review.warnings).toContainEqual(expect.stringContaining("300 on the invoice, 500 received on GRN PRC-8002"));
    expect(c.status).toBe("ready");
    await service.approveMany(ORG, [c.id], USER);
    const v = (await service.getView(ORG, c.id))!;
    const [pushed] = await service.pushMany(ORG, [{ id: c.id, hash: v.hash }], USER);
    expect(pushed).toMatchObject({ ok: true, message: expect.stringContaining("PO-7002 is set up to invoice these lines in Sawwi Demo Trading LLC") });
    expect((await service.getView(ORG, c.id))!.erp).toMatchObject({ mode: "order", number: "PO-7002", erpTotal: null });
    // In the mock, the order line now invoices 300 at 22 and receives nothing.
    const line = (await bcOpenOrderLines(DEMO_BC_CREDENTIALS, { vendorNumber: "V0002" }, demoDeps)).find((l) => l.orderNumber === "PO-7002")!;
    const res = await demoDeps.fetch(
      `https://api.businesscentral.dynamics.com/v2.0/${DEMO_BC_CREDENTIALS.tenantId}/${DEMO_BC_CREDENTIALS.environment}/api/v2.0/companies(${(await companyId())})/purchaseOrders(${line.orderId})/purchaseOrderLines`,
      { method: "GET", headers: { Authorization: "Bearer mock-bc-access-token" } },
    );
    const lines = ((await res.json()) as { value: Record<string, unknown>[] }).value;
    expect(lines.find((l) => l.id === line.lineId)).toMatchObject({ invoiceQuantity: 300, receiveQuantity: 0, directUnitCost: 22 });
  });

  it("keeps a failed push under Failed with the reason, and clears it once pushed (D-86)", async () => {
    const [dup] = (await service.listViews(ORG)).filter((v) => v.draft.invoiceNumber === "GLS-2307");
    expect(dup.failure).toMatchObject({ stage: "push", message: expect.stringContaining("already in Business Central as PI-9003"), attempts: 1 });
    expect(dup.review.warnings[0]).toMatch(/^The last push failed/);
    expect(dup.status).toBe("approved");
  });

  it("reads the scanned sample by OCR and matches its vendor by name", async () => {
    const { capture: c } = await sample("al-noor-anp-0419-scan");
    expect(c.source.method).toBe("ocr");
    expect(c.draft).toMatchObject({ vendorNo: "V0003", vendorMatchedBy: "name", invoiceNumber: "ANP-0419", total: 3150, dueDate: "" });
  }, 60_000);

  it("bulk-approves several and exports them as one CSV, one row per line", async () => {
    const views = await service.listViews(ORG);
    const scan = views.find((v) => v.draft.invoiceNumber === "ANP-0419")!;
    await service.saveEdits(ORG, scan.id, { ...scan.draft, lines: scan.draft.lines.map((l) => ({ ...l, erpType: "account" as const, erpNo: "6120" })) });
    const results = await service.approveMany(ORG, views.map((v) => v.id), USER);
    expect(results.find((r) => r.id === scan.id)?.ok).toBe(true);
    expect(results.filter((r) => !r.ok).length).toBeGreaterThan(0); // the pushed ones
    const drafts = await service.draftsForExport(ORG, "approved");
    const rows = drafts.flatMap((c) => csvRows(c.draft));
    const csv = Papa.parse<string[]>(Papa.unparse({ fields: CSV_HEADERS, data: rows })).data;
    expect(csv[0]).toEqual(CSV_HEADERS);
    expect(rows.find((r) => r[3] === "ANP-0419")).toEqual([
      "V0003", "Al Noor Packaging Materials", "100456789000003", "ANP-0419", "2026-10-30", "", "AED", "", "10000", "G/L Account", "6120",
      "Shipping carton 60x40x40", "", "500", "4.5", "5", "2250", "112.5", "3000", "150", "3150", "Purchase invoice", "", "", "", "",
    ]);
  });
});

async function companyId() {
  const res = await demoDeps.fetch(`https://api.businesscentral.dynamics.com/v2.0/${DEMO_BC_CREDENTIALS.tenantId}/${DEMO_BC_CREDENTIALS.environment}/api/v2.0/companies`, {
    method: "GET",
    headers: { Authorization: "Bearer mock-bc-access-token" },
  });
  const companies = ((await res.json()) as { value: { id: string; name: string; displayName?: string }[] }).value;
  return companies.find((c) => c.name === DEMO_BC_CREDENTIALS.company || c.displayName === DEMO_BC_CREDENTIALS.company)!.id;
}

describe("three-way match: invoice lines against PO lines and GRNs (D-88)", () => {
  const G = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const open = (o: Partial<ErpOpenOrderLine>): ErpOpenOrderLine => ({
    orderId: G(1), orderNumber: "PO-1", vendorNumber: "V1", orderDate: "2026-11-01", lineId: G(10), sequence: 10000, itemNumber: "A", description: "", quantity: 10, received: 10, invoiced: 0, directUnitCost: 5, receipts: ["GRN-1"], ...o,
  });
  const draft = (lines: { no: string; qty: number; price: number }[], extra: Partial<Draft> = {}): Draft => ({
    supplierName: "S", supplierTrn: "", invoiceNumber: "X1", invoiceDate: "2026-11-20", dueDate: "", currency: "SAR", poNumber: "", subtotal: null, vat: null, total: 1, vendorNo: "V1", vendorName: "",
    lines: lines.map((l) => ({ description: l.no, sku: "", qty: l.qty, unitPrice: l.price, net: l.qty * l.price, vatRate: null, vat: null, erpType: "item" as const, erpNo: l.no })),
    ...extra,
  });

  it("links each line to an open order line, exact quantity first, then the oldest that covers it", () => {
    const pool = [
      open({ lineId: G(10), orderNumber: "PO-1", orderDate: "2026-10-01", received: 8 }),
      open({ lineId: G(11), orderNumber: "PO-2", orderDate: "2026-10-05", received: 5 }),
      open({ lineId: G(12), orderNumber: "PO-3", orderDate: "2026-10-09", itemNumber: "B", received: 4, invoiced: 4 }),
    ];
    const d = matchOrders(draft([{ no: "A", qty: 5, price: 5 }]), pool);
    expect(d.lines[0].po).toMatchObject({ orderNumber: "PO-2", open: 5 });
    expect(d.postTo).toBe("order");
    const two = matchOrders(draft([{ no: "A", qty: 6, price: 5 }, { no: "B", qty: 1, price: 5 }]), pool);
    expect(two.lines.map((l) => l.po?.orderNumber ?? null)).toEqual(["PO-1", null]);
    expect(two.postTo).toBeUndefined();
    // A printed PO number narrows it to that order.
    expect(matchOrders(draft([{ no: "A", qty: 5, price: 5 }], { poNumber: "po 1" }), pool).lines[0].po?.orderNumber).toBe("PO-1");
  });

  it("blocks more than was received, two lines on one order line, and a standalone invoice for received goods; warns on price", () => {
    const pool = [open({ received: 4 })];
    const over = matchOrders(draft([{ no: "A", qty: 6, price: 5.5 }]), pool);
    const r = reviewDraft(over, { erp: true });
    expect(r.blockers).toContainEqual(expect.stringContaining("6 invoiced, but only 4 received and not yet invoiced on PO-1 (GRN GRN-1)"));
    expect(r.warnings).toContainEqual(expect.stringContaining("price 5.5 against 5 on PO-1 (+10.0%)"));
    const twice = { ...over, lines: [over.lines[0], { ...over.lines[0], qty: 1 }], postTo: "order" as const };
    expect(reviewDraft(twice, { erp: true }).blockers).toContainEqual(expect.stringContaining("invoice the same order line"));
    const mixed = matchOrders(draft([{ no: "A", qty: 2, price: 5 }, { no: "Z", qty: 1, price: 5 }]), pool);
    expect(reviewDraft(mixed, { erp: true }).blockers).toEqual([expect.stringContaining("was received on PO-1 (GRN GRN-1)")]);
    // The user chose a standalone invoice: a warning, not a blocker.
    const chosen = matchOrders({ ...mixed, postTo: "invoice" }, pool);
    expect(chosen.postTo).toBe("invoice");
    expect(reviewDraft(chosen, { erp: true }).blockers).toEqual([]);
    expect(orderPlan(matchOrders(draft([{ no: "A", qty: 3, price: 5 }]), pool))).toEqual([
      { orderId: G(1), orderNumber: "PO-1", vendorNumber: "V1", lines: [{ lineId: G(10), itemNumber: "A", invoiceQuantity: 3, directUnitCost: 5 }] },
    ]);
  });

  it("asks the user to confirm a suggested match; a printed PO that agrees is confirmed already", () => {
    const pool = [open({ orderNumber: "PO-1" })];
    const suggested = matchOrders(draft([{ no: "A", qty: 2, price: 5 }]), pool);
    expect(suggested).toMatchObject({ postTo: "order", poConfirmed: undefined });
    expect(reviewDraft(suggested, { erp: true }).blockers).toEqual([expect.stringContaining("prints no PO number: Sawwi suggested")]);
    expect(reviewDraft({ ...suggested, poConfirmed: true }, { erp: true }).blockers).toEqual([]);
    expect(matchOrders(draft([{ no: "A", qty: 2, price: 5 }], { poNumber: "PO-1" }), pool).poConfirmed).toBe(true);
    // A printed PO whose price differs still needs a person to confirm.
    expect(matchOrders(draft([{ no: "A", qty: 2, price: 6 }], { poNumber: "PO-1" }), pool).poConfirmed).toBeUndefined();
    // Picking another order line withdraws a confirmation.
    const picked = pickOrderLine({ ...suggested, poConfirmed: true }, 0, open({ lineId: G(99), orderNumber: "PO-9" }));
    expect(picked).toMatchObject({ poConfirmed: undefined, lines: [{ po: { orderNumber: "PO-9", lineId: G(99) } }] });
    expect(candidatesFor("A", [...pool, open({ lineId: G(98), invoiced: 10 })]).map((o) => o.lineId)).toEqual([G(10)]);
  });

  it("finds the GRN that matches the invoice, and takes the PO line from that GRN's order (D-92)", () => {
    const pool = [
      open({ lineId: G(10), orderNumber: "PO-1", orderDate: "2026-10-01", received: 20 }),
      open({ lineId: G(11), orderId: G(2), orderNumber: "PO-2", orderDate: "2026-10-05", received: 6 }),
    ];
    const receipt = (number: string, orderNumber: string, postingDate: string, qty: number): ErpReceipt => ({ id: number, number, orderNumber, vendorNumber: "V1", postingDate, lines: [{ itemNumber: "A", description: "", quantity: qty, unitCost: 5 }] });
    const receipts = [receipt("GRN-1", "PO-1", "2026-10-03", 20), receipt("GRN-2", "PO-2", "2026-10-07", 6)];
    // 6 on the invoice: GRN-2 received exactly 6, so its order PO-2 is used, though PO-1 is older and covers it.
    const d = matchOrders(draft([{ no: "A", qty: 6, price: 5 }]), pool, receipts);
    expect(d.lines[0]).toMatchObject({ grn: { number: "GRN-2", orderNumber: "PO-2", quantity: 6 }, po: { orderNumber: "PO-2" } });
    expect(d.poConfirmed).toBeUndefined();
    expect(reviewDraft({ ...d, poConfirmed: true }, { erp: true }).blockers).toEqual([]);
    // A GRN linked by the user narrows it; when the lines agree with it exactly, the match is confirmed.
    const linked = matchOrders(draft([{ no: "A", qty: 20, price: 5 }], { grnNumber: "grn-1" }), pool, receipts);
    expect(linked).toMatchObject({ poConfirmed: true, lines: [{ grn: { number: "GRN-1" }, po: { orderNumber: "PO-1" } }] });
    // Picking another GRN moves the order line to that GRN's order and withdraws a confirmation.
    const moved = pickGrn(linked, 0, grnOptionsFor("A", receipts).find((g) => g.number === "GRN-2")!, pool);
    expect(moved).toMatchObject({ poConfirmed: undefined, lines: [{ grn: { number: "GRN-2" }, po: { orderNumber: "PO-2" } }] });
    // A GRN on one PO while the line is matched to another blocks.
    const mixed = { ...d, poConfirmed: true, lines: [{ ...d.lines[0], grn: { ...d.lines[0].grn!, orderNumber: "PO-1" } }] };
    expect(reviewDraft(mixed, { erp: true }).blockers).toContainEqual(expect.stringContaining("GRN GRN-2 is for PO-1, but the line is matched to PO-2"));
  });

  it("keeps PO links through sanitizing only when they look like Business Central's", () => {
    const d = matchOrders(draft([{ no: "A", qty: 1, price: 5 }]), [open({})]);
    expect(sanitizeDraft(JSON.parse(JSON.stringify(d)))!.lines[0].po).toEqual(d.lines[0].po);
    expect(sanitizeDraft({ ...d, lines: [{ ...d.lines[0], po: { ...d.lines[0].po, lineId: "../x" } }] })!.lines[0].po).toBeNull();
  });

  it("reads open order lines with their GRNs, sets one up to invoice, and refuses more than was received (mock BC)", async () => {
    const writes = new Map();
    const deps: ConnectorDeps = { fetch: mockBusinessCentral({ writes }), sleep: async () => {} };
    const lines = await bcOpenOrderLines(DEMO_BC_CREDENTIALS, { vendorNumber: "V0002" }, deps);
    expect(lines.map((l) => [l.orderNumber, l.itemNumber, l.received - l.invoiced, l.receipts])).toEqual([["PO-7002", "LED-40", 500, ["PRC-8002"]]]);
    const [led] = lines;
    await expect(bcPrepareOrderInvoice(DEMO_BC_CREDENTIALS, [{ orderId: led.orderId, orderNumber: "PO-7002", vendorNumber: "V0002", lines: [{ lineId: led.lineId, itemNumber: "LED-40", invoiceQuantity: 600, directUnitCost: 22 }] }], deps)).rejects.toThrow(
      /only 500 received and not invoiced/,
    );
    const done = await bcPrepareOrderInvoice(DEMO_BC_CREDENTIALS, [{ orderId: led.orderId, orderNumber: "PO-7002", vendorNumber: "V0002", lines: [{ lineId: led.lineId, itemNumber: "LED-40", invoiceQuantity: 120, directUnitCost: 22.5 }] }], deps);
    expect(done).toEqual({ company: "Sawwi Demo Trading LLC", orders: ["PO-7002"] });
    const overlay = [...writes.entries()].find(([k]) => String(k).endsWith("/purchaseOrderLines"))![1] as Record<string, unknown>[];
    expect(overlay).toEqual([{ id: led.lineId, invoiceQuantity: 120, receiveQuantity: 0, directUnitCost: 22.5 }]);
    // Pulled by number, every item line of the order shows, invoiced or not.
    expect((await bcOpenOrderLines(DEMO_BC_CREDENTIALS, { orderNumber: "PO-7003" }, deps)).map((l) => [l.itemNumber, l.received, l.invoiced, l.vendorNumber])).toEqual([["FAN-1200", 100, 100, "V0002"]]);
    // Another vendor's order, or another item on the line, is refused before anything changes.
    await expect(bcPrepareOrderInvoice(DEMO_BC_CREDENTIALS, [{ orderId: led.orderId, orderNumber: "PO-7002", vendorNumber: "V0001", lines: [{ lineId: led.lineId, itemNumber: "LED-40", invoiceQuantity: 1, directUnitCost: 22 }] }], deps)).rejects.toThrow(/belongs to vendor V0002/);
    await expect(bcPrepareOrderInvoice(DEMO_BC_CREDENTIALS, [{ orderId: led.orderId, orderNumber: "PO-7002", vendorNumber: "V0002", lines: [{ lineId: led.lineId, itemNumber: "AC-18K", invoiceQuantity: 1, directUnitCost: 22 }] }], deps)).rejects.toThrow(/not AC-18K/);
  });

  it("reads a vendor's recent GRNs, or one by number (mock BC, D-92)", async () => {
    const deps: ConnectorDeps = { fetch: mockBusinessCentral(), sleep: async () => {} };
    const recent = await bcReceipts(DEMO_BC_CREDENTIALS, { vendorNumber: "V0002", since: "2026-06-01" }, deps);
    expect(recent.map((r) => [r.number, r.orderNumber, r.lines.map((l) => [l.itemNumber, l.quantity])])).toEqual([
      ["PRC-8002", "PO-7002", [["LED-40", 500]]],
      ["PRC-8003", "PO-7003", [["FAN-1200", 100]]],
    ]);
    expect(await bcReceipts(DEMO_BC_CREDENTIALS, { vendorNumber: "V0002", since: "2026-12-01" }, deps)).toEqual([]);
    expect((await bcReceipts(DEMO_BC_CREDENTIALS, { receiptNumber: "PRC-8001" }, deps)).map((r) => [r.vendorNumber, r.orderNumber])).toEqual([["V0001", "PO-7001"]]);
  });

  it("is refused cleanly by an app that can't edit purchase documents", async () => {
    const deps: ConnectorDeps = { fetch: mockBusinessCentral({ readOnly: true }), sleep: async () => {} };
    const [led] = await bcOpenOrderLines(DEMO_BC_CREDENTIALS, { vendorNumber: "V0002" }, deps);
    await expect(bcPrepareOrderInvoice(DEMO_BC_CREDENTIALS, [{ orderId: led.orderId, orderNumber: "PO-7002", vendorNumber: "V0002", lines: [{ lineId: led.lineId, itemNumber: "LED-40", invoiceQuantity: 1, directUnitCost: 22 }] }], deps)).rejects.toThrow(
      /D365 PURCH DOC, EDIT/,
    );
  });
});

describe("Excel download (D-87)", () => {
  it("has an Invoices sheet with status and what's open, and a Lines sheet with PO and GRN", async () => {
    const views = await service.listViews(ORG);
    const bytes = await capturesWorkbook(views, { erp: true });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Invoices", "Lines"]);
    const inv = wb.getWorksheet("Invoices")!;
    expect(inv.rowCount).toBe(views.length + 1);
    const header = (inv.getRow(1).values as unknown[]).slice(1);
    const gls = inv.getRows(2, views.length)!.find((r) => r.getCell(header.indexOf("Vendor invoice no.") + 1).value === "GLS-2360")!;
    expect(gls.getCell(header.indexOf("Post to") + 1).value).toBe("Purchase order");
    expect(gls.getCell(header.indexOf("GRN no.") + 1).value).toBe("PRC-8002");
    expect(gls.getCell(header.indexOf("Amount incl. VAT") + 1).value).toBe(6930);
    const lines = wb.getWorksheet("Lines")!;
    expect(lines.rowCount).toBe(views.reduce((n, v) => n + v.draft.lines.length, 0) + 1);
    // Standard columns first; line VAT worked out from the invoice's rate where the line prints none (D-91).
    const lh = (lines.getRow(1).values as unknown[]).slice(1);
    expect(lh.slice(0, 16)).toEqual([
      "Supplier", "Supplier VAT no.", "Invoice no.", "Invoice date", "Due date", "Currency", "PO no. (printed)", "Line",
      "Item code / barcode", "Description", "Quantity", "Unit price", "Amount excl. VAT", "VAT %", "VAT amount", "Amount incl. VAT",
    ]);
    const row = lines.getRows(2, lines.rowCount - 1)!.find((r) => r.getCell(lh.indexOf("Invoice no.") + 1).value === "GLS-2360")!;
    expect([row.getCell(lh.indexOf("Amount excl. VAT") + 1).value, row.getCell(lh.indexOf("VAT amount") + 1).value, row.getCell(lh.indexOf("Amount incl. VAT") + 1).value]).toEqual([6600, 330, 6930]);
  });

  it("works out line VAT from the invoice's rate only when the line prints none, and says so", async () => {
    const base = (await service.listViews(ORG))[0];
    const line = (vat: number | null) => ({ description: "x", sku: "A1", qty: 2, unitPrice: 50, net: 100, vatRate: null, vat, erpType: null, erpNo: "" });
    const c = { ...base, draft: { ...base.draft, subtotal: 200, vat: 30, total: 230, lines: [line(null), line(15)] } };
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await capturesWorkbook([c], { erp: false }));
    const ws = wb.getWorksheet("Lines")!;
    const h = (ws.getRow(1).values as unknown[]).slice(1);
    const at = (r: number, name: string) => ws.getRow(r).getCell(h.indexOf(name) + 1).value;
    expect([at(2, "VAT %"), at(2, "VAT amount"), at(2, "Line VAT")]).toEqual([15, 15, "Worked out from invoice rate"]);
    expect([at(3, "VAT amount"), at(3, "Line VAT")]).toEqual([15, "Printed"]);
  });

  it("downloads a whole tab at once (D-90)", async () => {
    const all = await service.listViews(ORG);
    expect((await service.draftsForExport(ORG, "all")).length).toBe(all.length);
    expect((await service.draftsForExport(ORG, "pushed")).map((c) => c.id).sort()).toEqual(all.filter((v) => v.status === "pushed").map((v) => v.id).sort());
    expect((await service.draftsForExport(ORG, "failed")).every((c) => c.status === "failed" || c.failure?.stage === "push")).toBe(true);
  });
});
