import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runReconciliation } from "@/lib/runs/reconcile";
import * as runStore from "@/lib/runs/store";
import { buildRunView } from "@/lib/runs/view";
import { TEMPLATES } from "@/lib/templates/catalog";
import { DEMO_ORG_KEY } from "@/lib/demo/demo";
import { demoData } from "./demo";
import { DEMO_WINDOW, fillRunWithDemoData } from "./demo-fill";
import { availableConnectors } from "./registry";
import { pullIntoRun } from "./service";
import { importSources } from "./sources";

// The demo store's one-click fill (D-31, D-32): every covered template fills from the built-in
// demo sources and finds the planted exceptions. All data is invented; nothing leaves the process.

const env = process.env as Record<string, string | undefined>;

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sawwi-demo-"));
  env.SAWWI_DATA_DIR = dir;
  // The demo never calls the AI, even when a key is configured.
  env.ANTHROPIC_API_KEY = "sk-ant-test-not-used";
});
afterAll(() => {
  delete env.ANTHROPIC_API_KEY;
  rmSync(dir, { recursive: true, force: true });
});

async function demoRun(templateId: string) {
  const run = await runStore.createRun(DEMO_ORG_KEY, templateId);
  const fill = await fillRunWithDemoData(run, { countries: ["AE"] });
  const view = (await buildRunView(run.id))!;
  const result = view.status === "ready" ? await runReconciliation((await runStore.getRun(run.id))!, ["AE"]) : undefined;
  return { fill, view, found: result?.exceptions.map((e) => `${e.check}: ${e.key}`).sort() ?? [] };
}

const EXPECTED: Record<string, string[]> = {
  "web-orders-vs-gateway": ["amount_mismatch: 000000108", "paid_not_settled: 000000110", "settled_no_order: 000000199"],
  "web-bnpl": ["not_captured: 000000109"],
  "web-cod-remittance": ["delivered_not_remitted: 4410023399", "rto_marked_delivered: 000000105", "short_collected: 4410023307"],
  "web-refunds-vs-returns": ["refund_no_return: 000000103 / OUD-50", "return_no_refund: 000000104 / ABY-BLK-M"],
  // 4410023302 is billed twice, so its charged weight also exceeds what was declared.
  "web-courier-freight": ["duplicate_awb: 4410023302", "unknown_awb: 4410029999", "weight_dispute: 4410023301", "weight_dispute: 4410023302"],
  // Magento ↔ Business Central (the store company's books). 104 is posted twice, so its total and VAT differ too.
  "web-erp-invoices": [
    "customer_mismatch: 000000102", "duplicate_posting: 000000104 / 840.00", "not_synced: 000000103",
    "total_mismatch: 000000104", "total_mismatch: 000000106", "vat_mismatch: 000000104", "vat_mismatch: 000000106", "vat_mismatch: 000000108",
  ],
  // 103's refund is posted twice, so its amount and VAT differ too; 108's goodwill refund carries no VAT in Magento.
  "web-erp-credit-memos": [
    "amount_mismatch: 000000103", "amount_mismatch: 000000108", "duplicate_posting: 000000103 / 305.00", "not_posted: 000000106",
    "vat_mismatch: 000000103", "vat_mismatch: 000000108",
  ],
  "web-erp-stock": ["hidden_stock: SND-42", "not_in_erp: OUD-100", "overselling: OUD-50"],
  "b2b-cash-application": ["overdue: SI-3102", "overdue: SI-3104", "overdue: SI-3105", "overdue: SI-3106", "short_paid: SI-3103", "unapplied_receipt: TT REF 88213 MARINA FM"],
  "b2b-order-delivery-invoice": ["invoiced_not_delivered: LED-40", "open_orders: SO-1043 / CBL-25", "qty_mismatch: SSH-2103 / AC-18K"],
  // Marketplace templates: one invented seller (MP-10xx orders, two October settlements).
  "mkt-settlement-vs-sales": ["ageing: MP-1009", "duplicate_settlement: MP-1006", "not_invoiced: MP-1099", "not_settled: MP-1009", "short_paid: MP-1004"],
  "mkt-b2b-payment-release": ["on_hold: INV-B2B-702", "overdue: INV-B2B-704", "short_released: INV-B2B-705", "unexplained_deduction: INV-B2B-703"],
  "mkt-returns-vs-invoiced": ["not_received: MP-1007 / MAT-01", "qty_mismatch: MP-1003 / MAT-01", "refund_exceeds_invoice: MP-1007 / MAT-01", "return_not_invoiced: MP-1097 / OUD-50"],
  "mkt-fee-rate-card": ["commission_overcharge: OUD-50", "unknown_fee: Electronics"],
  "mkt-fulfilment-inventory": ["short_received: FBA-SHP-01 / OUD-50"],
  "mkt-claims-vs-reimbursements": ["expiring: CASE-88101", "partial_paid: CASE-88102", "unpaid_claim: CASE-88101"],
  "mkt-ads-deductions": ["deducted_no_invoice: 2026-10"],
  "mkt-vat": ["fee_vat_unbacked: 2026-10", "rate_mismatch: row 11"], // row 11 is MP-1010, VAT 25.00 on 420.00
  // Statements, prices, returns, cheques, payouts and imports (finance-files.ts).
  "b2b-customer-statement": ["amount_diff: SI-3104", "missing_in_ours: DN-0045", "missing_in_theirs: SI-3105"],
  // GLS-2291 is entered twice in our ledger, so its amount differs from the statement's too.
  "p2p-supplier-statement": ["amount_diff: GLS-2291", "amount_diff: GLS-2307", "duplicate_bill: GLS-2291", "missing_in_ours: GLS-2315"],
  "b2b-price-compliance": [
    "expired_price: Marina Facilities Management / LED-40", "no_price: Desert Rose Contracting / CBL-25",
    "overcharged: Al Waha Hotels / LED-40", "overcharged: Al Waha Hotels / LED-40", "undercharged: Marina Facilities Management / AC-18K",
  ],
  "b2b-returns-vs-credit-notes": ["return_no_cn: RMA-0091", "value_mismatch: RMA-0088"],
  "b2b-pdc-clearing": ["amount_diff: 000416", "bounced: RETURNED CHEQUE INSUFFICIENT FUNDS", "due_not_deposited: 000414"],
  "bank-payouts": ["fx_difference: po_1119", "not_credited: po_1126", "unidentified_credit: REF 99812"],
  "p2p-import-landed-cost": [
    "declaration_unknown: HLCU5555000", "declared_below_invoice: MAEU7654321", "duplicate_freight: Oasis Freight Forwarding / FWD-8812",
    "freight_unknown: ONEY0000001", "no_declaration: 176-55512345", "no_freight_bill: 176-55512345",
  ],
  "p2p-three-way-match": [
    "invoiced_not_received: LED-40", "no_po: LED-40", "overdue_po: PO-7004 / AC-18K", "price_above_po: PO-7003 / FAN-1200",
    "received_not_invoiced: PO-7002 / LED-40", "short_received: PO-7001 / AC-18K", "short_received: PO-7003 / FAN-1200",
  ],
};

describe("Fill with demo data", () => {
  it("covers every template in the catalogue", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(TEMPLATES.map((t) => t.id).sort());
  });

  for (const [templateId, expected] of Object.entries(EXPECTED)) {
    it(`${templateId}: fills every file, asks nothing, finds the planted exceptions`, async () => {
      const { fill, view, found } = await demoRun(templateId);
      expect(fill.missing).toEqual([]);
      expect(view.slots.every((s) => s.file)).toBe(true);
      expect(view.openQuestions).toEqual([]);
      expect(found).toEqual(expected);
    });
  }

  it("only fills empty slots, from the built-in sources", async () => {
    const run = await runStore.createRun(DEMO_ORG_KEY, "web-orders-vs-gateway");
    const first = await fillRunWithDemoData(run, { countries: ["AE"] });
    const again = await fillRunWithDemoData(run, { countries: ["AE"] });
    expect(first.filled).toHaveLength(2);
    expect(again.filled).toEqual([]);
    expect((await importSources(DEMO_ORG_KEY)).map((s) => s.connectionId)).toEqual(["demo:business-central", "demo:business-central-store", "demo:magento", "demo:demo-data"]);
    expect((await runStore.getUsage(run.id)).calls).toBe(0); // no AI calls
  });

  it("keeps the two Business Central companies' reports apart (D-52)", async () => {
    const sources = await importSources(DEMO_ORG_KEY);
    const reports = (id: string) => sources.find((s) => s.connectionId === id)!.reports.map((r) => r.id);
    expect(reports("demo:business-central-store")).toEqual(["web_sales_invoices", "web_sales_credit_memos", "items"]);
    expect(reports("demo:business-central")).not.toContain("web_sales_invoices");
    expect(reports("demo:business-central")).toContain("sales_invoices");
    const run = await runStore.createRun(DEMO_ORG_KEY, "b2b-cash-application");
    await expect(pullIntoRun(run, "invoices", "demo:business-central-store", "sales_invoices", DEMO_WINDOW, { countries: ["AE"] })).rejects.toThrow(/Unknown report/);
  });

  it("is invisible and refused outside the demo store", async () => {
    const run = await runStore.createRun("acme", "web-bnpl");
    expect(availableConnectors().map((c) => c.id)).not.toContain("demo-data");
    expect(await importSources("acme")).toEqual([]);
    expect(() => demoData.parseCredentials({})).toThrow(/demo store/);
    await expect(fillRunWithDemoData(run, { countries: ["AE"] })).rejects.toThrow(/demo store/);
    await expect(pullIntoRun(run, "orders", "demo:magento", "orders", { from: "2026-10-01", to: "2026-10-31" }, { countries: ["AE"] })).rejects.toThrow(/no longer exists/);
  });

  it("filters dated demo files to the period", async () => {
    const deps = { fetch: async () => { throw new Error("no network"); }, sleep: async () => {} };
    const t = await demoData.pull({}, "card_settlement", { from: "2026-10-01", to: "2026-10-07" }, deps);
    expect(t.rows.map((r) => r[1])).toEqual(["ch_3Q101", "ch_3Q103"]);
    expect((await demoData.pull({}, "courier_rate_card", { from: "2030-01-01", to: "2030-01-31" }, deps)).rows).toHaveLength(8); // undated
  });
});
