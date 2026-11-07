import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runReconciliation } from "@/lib/runs/reconcile";
import * as runStore from "@/lib/runs/store";
import { buildRunView } from "@/lib/runs/view";
import { demoData } from "./demo";
import { fillRunWithDemoData } from "./demo-fill";
import { mockBusinessCentral, isBusinessCentralUrl } from "./mock/business-central";
import { isMagentoMockUrl, mockMagento } from "./mock/magento";
import { availableConnectors } from "./registry";
import { importSources } from "./sources";
import type { ConnectorDeps, FetchLike } from "./types";

// The one-click demo (D-31): every covered template fills from the mocks and finds the planted
// exceptions. All data is invented; nothing leaves the process.

const bc = mockBusinessCentral({ pageSize: 50 });
const mg = mockMagento();
const fetch: FetchLike = async (url, init) => {
  if (isBusinessCentralUrl(url)) return bc(url, init);
  if (isMagentoMockUrl(url)) return mg(url, init);
  throw new Error(`Unexpected request to ${url}`);
};
const deps: ConnectorDeps = { fetch, sleep: async () => {} };
const env = process.env as Record<string, string | undefined>;

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sawwi-demo-"));
  env.SAWWI_DATA_DIR = dir;
  env.SAWWI_CONNECTOR_KEY = randomBytes(32).toString("base64");
  env.SAWWI_CONNECTOR_MOCK = "business-central,magento";
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
});
afterAll(() => {
  delete env.SAWWI_CONNECTOR_MOCK;
  rmSync(dir, { recursive: true, force: true });
});

async function demoRun(templateId: string) {
  const run = runStore.createRun("demo", templateId);
  const fill = await fillRunWithDemoData(run, { countries: ["AE"] }, null, deps);
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

  it("connects the demo sources once and only fills empty slots", async () => {
    const run = runStore.createRun("demo", "web-orders-vs-gateway");
    const first = await fillRunWithDemoData(run, { countries: ["AE"] }, null, deps);
    const again = await fillRunWithDemoData(run, { countries: ["AE"] }, null, deps);
    expect(first.filled).toHaveLength(2);
    expect(again.filled).toEqual([]);
    expect(importSources("demo").map((s) => s.provider).sort()).toEqual(["business-central", "demo-data", "magento"]);
  });

  it("is invisible and refuses to work outside demo mode", async () => {
    const before = env.SAWWI_CONNECTOR_MOCK;
    try {
      delete env.SAWWI_CONNECTOR_MOCK;
      expect(availableConnectors().map((c) => c.id)).not.toContain("demo-data");
      expect(importSources("demo").map((s) => s.provider)).not.toContain("demo-data");
      expect(() => demoData.parseCredentials({})).toThrow(/demo mode/);
      await expect(demoData.pull({}, "card_settlement", { from: "2026-10-01", to: "2026-10-31" }, deps)).rejects.toThrow(/demo mode/);
      await expect(fillRunWithDemoData(runStore.createRun("demo", "web-bnpl"), { countries: ["AE"] }, null, deps)).rejects.toThrow(/demo mode/);
    } finally {
      env.SAWWI_CONNECTOR_MOCK = before;
    }
  });

  it("filters dated demo files to the period", async () => {
    const t = await demoData.pull({}, "card_settlement", { from: "2026-10-01", to: "2026-10-07" }, deps);
    expect(t.rows.map((r) => r[1])).toEqual(["ch_3Q101", "ch_3Q103"]);
    expect((await demoData.pull({}, "courier_rate_card", { from: "2030-01-01", to: "2030-01-31" }, deps)).rows).toHaveLength(8); // undated
  });
});
