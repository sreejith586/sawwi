import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runReconciliation } from "@/lib/runs/reconcile";
import * as runStore from "@/lib/runs/store";
import { buildRunView } from "@/lib/runs/view";
import { DEMO_ORG_KEY } from "@/lib/demo/demo";
import { demoData } from "./demo";
import { fillRunWithDemoData } from "./demo-fill";
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
  const run = runStore.createRun(DEMO_ORG_KEY, templateId);
  const fill = await fillRunWithDemoData(run, { countries: ["AE"] });
  const view = buildRunView(run.id)!;
  const result = view.status === "ready" ? runReconciliation(runStore.getRun(run.id)!, ["AE"]) : undefined;
  return { fill, view, found: result?.exceptions.map((e) => `${e.check}: ${e.key}`).sort() ?? [] };
}

const EXPECTED: Record<string, string[]> = {
  "web-orders-vs-gateway": ["amount_mismatch: 000000108", "paid_not_settled: 000000110", "settled_no_order: 000000199"],
  "web-bnpl": ["not_captured: 000000109"],
  "web-cod-remittance": ["delivered_not_remitted: 4410023399", "rto_marked_delivered: 000000105", "short_collected: 4410023307"],
  "web-refunds-vs-returns": ["refund_no_return: 000000103 / OUD-50", "return_no_refund: 000000104 / ABY-BLK-M"],
  // 4410023302 is billed twice, so its charged weight also exceeds what was declared.
  "web-courier-freight": ["duplicate_awb: 4410023302", "unknown_awb: 4410029999", "weight_dispute: 4410023301", "weight_dispute: 4410023302"],
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
  "p2p-three-way-match": [
    "invoiced_not_received: LED-40", "no_po: LED-40", "overdue_po: PO-7004 / AC-18K", "price_above_po: PO-7003 / FAN-1200",
    "received_not_invoiced: PO-7002 / LED-40", "short_received: PO-7001 / AC-18K", "short_received: PO-7003 / FAN-1200",
  ],
};

describe("Fill with demo data", () => {
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
    const run = runStore.createRun(DEMO_ORG_KEY, "web-orders-vs-gateway");
    const first = await fillRunWithDemoData(run, { countries: ["AE"] });
    const again = await fillRunWithDemoData(run, { countries: ["AE"] });
    expect(first.filled).toHaveLength(2);
    expect(again.filled).toEqual([]);
    expect(importSources(DEMO_ORG_KEY).map((s) => s.connectionId)).toEqual(["demo:business-central", "demo:magento", "demo:demo-data"]);
    expect(runStore.getUsage(run.id).calls).toBe(0); // no AI calls
  });

  it("is invisible and refused outside the demo store", async () => {
    const run = runStore.createRun("acme", "web-bnpl");
    expect(availableConnectors().map((c) => c.id)).not.toContain("demo-data");
    expect(importSources("acme")).toEqual([]);
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
