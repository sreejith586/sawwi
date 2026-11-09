import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Papa from "papaparse";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bcCustomerPayments } from "@/lib/connectors/business-central";
import { DEMO_BC_STORE_CREDENTIALS, mockBusinessCentral } from "@/lib/connectors/mock/business-central";
import { DEMO_STORE_PAYMENT_JOURNAL_ID } from "@/lib/connectors/mock/business-central-store-data";
import { resetDemoErpWrites } from "@/lib/connectors/mock";
import type { ConnectorDeps } from "@/lib/connectors/types";
import { DEMO_ORG_KEY } from "@/lib/demo/demo";
import { parseUploads } from "@/lib/files/parse";
import { parseRemittances } from "./parse";
import { CSV_HEADERS, draftFromParsed, emptyCodSettings, remittanceCsv, reviewRemittance } from "./remittance";
import { COD_SAMPLES } from "./samples";
import * as service from "./service";

// COD remittances → customer payments applied to invoices (D-74–D-77), against the mock Business
// Central store company. Invented data; nothing leaves the process.

const env = process.env as Record<string, string | undefined>;
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sawwi-cod-"));
  env.SAWWI_DATA_DIR = dir;
  resetDemoErpWrites();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function parsed(id: string) {
  const s = COD_SAMPLES.find((x) => x.id === id)!;
  return parseRemittances(await parseUploads([{ name: s.fileName, data: new TextEncoder().encode(s.text()) }]), s.fileName);
}

const ACCOUNTS = { bank: "1020", clearing: "1170", fees: "6150", feeVat: "2320" };

describe("reading remittance reports", () => {
  it("reads Aramex's layout: courier, batch, date, six parcels, the totals row left out", async () => {
    const [b] = await parsed("aramex-2026-11-07");
    expect(b).toMatchObject({ batchId: "ARX-RMT-2026-11-07", courier: "Aramex", remittanceDate: "2026-11-07", currency: "AED", statedNet: 1766.5 });
    expect(b.parcels).toHaveLength(6);
    expect(b.parcels[2]).toMatchObject({ awb: "4410031003", orderRef: "000000133", collected: 370, fee: 5, vat: 0.25, net: 364.75 });
  });

  it("works VAT on the fee out from the net when the report has no VAT column (D-76)", async () => {
    const [b] = await parsed("smsa-2026-11-08");
    expect(b).toMatchObject({ batchId: "SMSA-2026-11-08", courier: "SMSA", problems: [] });
    expect(b.parcels[1]).toMatchObject({ collected: 189, fee: 5, vat: 0.25, net: 183.75 });
  });

  it("flags a parcel whose net doesn't follow from collected and fee", () => {
    const [b] = parseRemittances({ headers: ["AWB", "Order ID", "Collected", "COD fee", "Net remitted", "Batch ID"], rows: [["1", "A", "100.00", "5.00", "90.00", "B1"]] });
    expect(b.problems[0]).toMatch(/isn't the net 90.00/);
  });
});

describe("the review", () => {
  it("without an ERP: payments for every parcel, the money side balances to the cent", async () => {
    const [b] = await parsed("aramex-2026-11-07");
    const r = reviewRemittance(draftFromParsed(b), { ...emptyCodSettings(), accounts: ACCOUNTS }, { erp: false });
    expect(r.blockers).toEqual([]);
    expect(r.payments).toHaveLength(6);
    expect(r.totals).toMatchObject({ collected: 1798, fees: 30, vat: 1.5, net: 1766.5 });
    expect(r.gl.reduce((a, l) => a + Math.round(l.amount * 100), 0)).toBe(0);
    const csv = Papa.parse<string[]>(remittanceCsv([{ draft: draftFromParsed(b), review: r }])).data;
    expect(csv[0]).toEqual(CSV_HEADERS);
    expect(csv.filter((x) => x[0] === "G/L").map((x) => [x[5], x[9]])).toEqual([["1020", "1766.5"], ["6150", "30"], ["2320", "1.5"], ["1170", "-1798"]]);
  });
});

describe("Business Central customer payments (D-75)", () => {
  const sleep = async () => {};
  it("reads open invoices, looks up paid ones, and refuses to apply to an invoice that isn't open", async () => {
    const writes = new Map<string, Record<string, unknown>[]>();
    const deps: ConnectorDeps = { fetch: mockBusinessCentral({ writes }), sleep };
    const open = await bcCustomerPayments.openInvoices(DEMO_BC_STORE_CREDENTIALS, deps);
    expect(open.map((i) => i.number).sort()).toEqual(["PSI-W1031", "PSI-W1032", "PSI-W1033", "PSI-W1036"]);
    expect(await bcCustomerPayments.lookupInvoices(DEMO_BC_STORE_CREDENTIALS, ["000000135", "000000134"], deps)).toMatchObject([{ number: "PSI-W1035", status: "Paid" }]);
    const base = { customerNumber: "WEB", postingDate: "2026-11-07", documentNumber: "T-1", externalDocumentNumber: "x", description: "x" };
    await expect(bcCustomerPayments.createPayments(DEMO_BC_STORE_CREDENTIALS, DEMO_STORE_PAYMENT_JOURNAL_ID, [{ ...base, appliesToInvoiceNumber: "PSI-W1031", amount: -430 }, { ...base, appliesToInvoiceNumber: "PSI-W1035", amount: -295 }], deps)).rejects.toThrow(/isn't open/);
    expect(await bcCustomerPayments.findDocument(DEMO_BC_STORE_CREDENTIALS, DEMO_STORE_PAYMENT_JOURNAL_ID, "T-1", deps)).toEqual([]);
  });
});

describe("COD in the demo store, end to end", () => {
  const ORG = DEMO_ORG_KEY;

  it("captures Aramex's batch and matches each parcel: applied, short, no invoice, already paid", async () => {
    const [r] = await service.captureSample(ORG, "u1", "aramex-2026-11-07");
    const { view: v } = (await service.getView(ORG, r.id))!;
    expect(v.draft.parcels.map((p) => [p.orderRef, p.invoiceNumber, p.invoiceState, p.action])).toEqual([
      ["000000131", "PSI-W1031", "open", "apply"],
      ["000000132", "PSI-W1032", "open", "apply"],
      ["000000133", "PSI-W1033", "open", "apply"],
      ["000000134", "", "none", null],
      ["000000135", "PSI-W1035", "paid", null],
      ["000000136", "PSI-W1036", "open", "apply"],
    ]);
    expect(v.review.flags["4410031003"]).toEqual(["short AED 10.00: the rest stays open"]);
    expect(v.status).toBe("needs_review");
    expect((await service.captureSample(ORG, "u1", "aramex-2026-11-07"))[0].existing).toBe(true);
  });

  it("catches a parcel already remitted in another batch", async () => {
    const [r] = await service.captureSample(ORG, "u1", "smsa-2026-11-08");
    const { view: v } = (await service.getView(ORG, r.id))!;
    expect(v.draft.currency).toBe("AED"); // no currency column: the company's own
    expect(v.draft.parcels[0]).toMatchObject({ awb: "4410031006", duplicateOf: "Aramex ARX-RMT-2026-11-07", action: null });
    expect(v.draft.parcels[1]).toMatchObject({ orderRef: "000000137", invoiceState: "none", action: null });
  });

  it("decisions, accounts and a default customer make it ready; it pushes payments and the journal", async () => {
    const aramex = (await service.listViews(ORG)).views.find((v) => v.courier === "Aramex")!;
    await service.saveEdits(ORG, aramex.id, { actions: { "4410031004": "on_account", "4410031005": "exclude" } });
    await service.updateSettings(ORG, { accounts: ACCOUNTS, defaultCustomer: "COD-UNAPPLIED" });
    const { view: v } = (await service.getView(ORG, aramex.id))!;
    expect(v.review.blockers).toEqual([]);
    expect(v.review.payments.map((p) => [p.customerNumber, p.invoiceNumber, p.amount])).toEqual([
      ["WEB", "PSI-W1031", -430], ["WEB", "PSI-W1032", -229], ["WEB", "PSI-W1033", -370], ["COD-UNAPPLIED", "", -315], ["WEB", "PSI-W1036", -159],
    ]);
    expect(v.review.warnings.join(" ")).toMatch(/AED 295.00 collected is left out/);
    expect(await service.approveMany(ORG, [v.id], "u1")).toEqual([{ id: v.id, ok: true }]);
    const approved = (await service.getView(ORG, v.id))!.view;
    const [res] = await service.pushMany(ORG, [{ id: v.id, hash: approved.hash }], "u1");
    expect(res).toMatchObject({ ok: true, message: "Aramex ARX-RMT-2026-11-07: 5 customer payments in batch CODRCPT and 4 journal lines in DEFAULT, unposted, in Sawwi Demo Store LLC." });
    expect((await service.pushMany(ORG, [{ id: v.id, hash: approved.hash }], "u1"))[0].ok).toBe(false);
  });

  it("CSV export covers payments and the journal", async () => {
    const aramex = (await service.listViews(ORG)).views.find((v) => v.courier === "Aramex")!;
    const out = await service.exportCsv(ORG, [aramex.id]);
    expect(out.csv.split("\n").filter((l) => l.startsWith("Customer payment"))).toHaveLength(5);
  });
});
