import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Papa from "papaparse";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bcPurchaseInvoices } from "@/lib/connectors/business-central";
import { DEMO_BC_CREDENTIALS, mockBusinessCentral } from "@/lib/connectors/mock/business-central";
import { resetDemoErpWrites } from "@/lib/connectors/mock";
import { ConnectorError, type ConnectorDeps } from "@/lib/connectors/types";
import { DEMO_ORG_KEY } from "@/lib/demo/demo";
import { readStoredFile } from "@/lib/files/storage";
import { CSV_HEADERS, csvRows, isoDate, normInvoiceNo, reviewDraft, sanitizeDraft, type Draft } from "./draft";
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
    await service.approveMany(ORG, [c.id], USER);
    const v = (await service.getView(ORG, c.id))!;
    expect((await service.pushMany(ORG, [{ id: c.id, hash: v.hash }], USER))[0]).toMatchObject({ ok: false, message: expect.stringContaining("already in Business Central as PI-9003") });
    expect((await service.getView(ORG, c.id))!.status).toBe("approved");
  });

  it("remembers a supplier's item codes and layout from a pushed invoice", async () => {
    const { capture: c } = await sample("gulf-lighting-gls-2342");
    expect(c.source.layout).toBe("remembered"); // GLS-2307 taught the layout
    expect(c.draft.lines.map((l) => l.erpNo)).toEqual(["LED-40", ""]);
    const coded = { ...c.draft, lines: c.draft.lines.map((l, i) => (i === 1 ? { ...l, erpType: "item" as const, erpNo: "FAN-1200", matchedBy: "user" as const } : l)) };
    await service.saveEdits(ORG, c.id, coded);
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
      "Shipping carton 60x40x40", "", "500", "4.5", "5", "2250", "112.5", "3000", "150", "3150",
    ]);
  });
});
