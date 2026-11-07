import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestFiles } from "@/lib/runs/engine";
import { runReconciliation } from "@/lib/runs/reconcile";
import * as runStore from "@/lib/runs/store";
import { buildRunView } from "@/lib/runs/view";
import { magento, MAGENTO_ORDER_COLUMNS, normaliseBaseUrl, searchQuery, windowGroups } from "./magento";
import { DEMO_MAGENTO_CREDENTIALS, mockMagento, type MockMagentoOptions } from "./mock/magento";
import { assertPublicUrl, isPrivateAddress, isPublicHostname } from "./net-guard";
import { addConnection, pullIntoRun } from "./service";
import * as store from "./store";
import { ConnectorError, type ConnectorDeps } from "./types";

// Everything runs against the in-process mock store (./mock): nothing calls a real shop.

const creds = magento.parseCredentials({ ...DEMO_MAGENTO_CREDENTIALS });
const october = { from: "2026-10-01", to: "2026-10-31" };
const deps = (opts: MockMagentoOptions = {}): ConnectorDeps => ({ fetch: mockMagento(opts), sleep: async () => {} });

beforeAll(() => {
  process.env.SAWWI_CONNECTOR_KEY = randomBytes(32).toString("base64");
});

describe("network guard", () => {
  it("refuses private, loopback, link-local and mapped addresses", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.20.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "nonsense"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "23.192.228.80", "2606:4700::1111", "172.32.0.1"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("accepts public host names only", () => {
    expect(isPublicHostname("shop.example.com")).toBe(true);
    for (const h of ["localhost", "127.0.0.1", "intranet", "magento.internal", "shop.local", "[::1]"]) expect(isPublicHostname(h), h).toBe(false);
  });

  it("checks where the host resolves before a live request", async () => {
    await expect(assertPublicUrl("https://shop.example.com/rest", async () => ["93.184.215.14"])).resolves.toBeUndefined();
    await expect(assertPublicUrl("https://shop.example.com/rest", async () => ["93.184.215.14", "10.0.0.5"])).rejects.toThrow(/private network/);
    await expect(assertPublicUrl("https://nowhere.example.com", async () => [])).rejects.toThrow(/Couldn't find/);
    await expect(assertPublicUrl("http://shop.example.com", async () => ["93.184.215.14"])).rejects.toThrow(/https/);
  });
});

describe("Magento credentials and requests", () => {
  it("normalises the store address and refuses unsafe ones", () => {
    expect(normaliseBaseUrl("shop.example.com")).toBe("https://shop.example.com");
    expect(normaliseBaseUrl("https://Shop.Example.com/en/index.php/rest/V1/orders")).toBe("https://shop.example.com/en");
    expect(normaliseBaseUrl("https://shop.example.com/admin_x/")).toBe("https://shop.example.com/admin_x");
    for (const bad of ["http://shop.example.com", "https://10.0.0.1", "https://localhost/", "https://shop.example.com:8443", "https://user:pw@shop.example.com", "magento.internal"]) {
      expect(() => normaliseBaseUrl(bad), bad).toThrow(ConnectorError);
    }
    expect(() => magento.parseCredentials({ baseUrl: "shop.example.com", accessToken: "short" })).toThrow(/Access Token/);
  });

  it("builds Magento searchCriteria for a window of whole days", () => {
    const q = decodeURIComponent(searchQuery(windowGroups(october), { size: 100, current: 2 }));
    expect(q).toContain("searchCriteria[filter_groups][0][filters][0][field]=created_at");
    expect(q).toContain("searchCriteria[filter_groups][0][filters][0][value]=2026-10-01+00:00:00");
    expect(q).toContain("searchCriteria[filter_groups][0][filters][0][condition_type]=gteq");
    expect(q).toContain("searchCriteria[filter_groups][1][filters][0][value]=2026-10-31+23:59:59");
    expect(q).toContain("searchCriteria[currentPage]=2");
  });

  it("tests the token with a one-order read and labels the store", async () => {
    const log: { method: string; url: string }[] = [];
    expect(await magento.test(creds, deps({ log }))).toEqual({ accountLabel: "Sawwi Demo Store (demo-store.sawwi-mock.example)" });
    expect(log).toHaveLength(1);
    expect(log[0].url.startsWith("https://demo-store.sawwi-mock.example/rest/V1/orders?")).toBe(true);
  });

  it("explains a bad token or a missing permission", async () => {
    await expect(magento.test({ ...creds, accessToken: "x".repeat(32) }, deps())).rejects.toThrow(/refused access[^]*standalone Bearer/);
    await expect(magento.pull(creds, "shipment_tracks", october, deps({ deny: ["Magento_Sales::shipment"] }))).rejects.toThrow(/Magento_Sales::shipment/);
    await expect(magento.test({ ...creds, baseUrl: "https://demo-store.sawwi-mock.example/shop" }, deps())).rejects.toThrow(/No Magento REST API/);
  });
});

describe("Magento reports", () => {
  it("pulls the month's orders across pages, inside the window only", async () => {
    const log: { method: string; url: string }[] = [];
    const t = await magento.pull(creds, "orders", october, deps({ maxPageSize: 4, log }));
    expect(t.headers).toEqual([...MAGENTO_ORDER_COLUMNS]);
    expect(log).toHaveLength(3); // 10 orders, 4 a page
    expect(t.rows.map((r) => r[0])).toEqual(["000000101", "000000102", "000000103", "000000104", "000000105", "000000106", "000000107", "000000108", "000000109", "000000110"]);
    expect(t.rows[0]).toEqual(["000000101", "2026-10-01T08:12:44Z", "complete", "stripe_payments", "Credit Card (Stripe)", "495.00", "0.00", "0.00", "AED", "471.43", "0.00", "23.57", "495.00", "Sawwi Demo Store"]);
    expect(t.rows[1].slice(3, 8)).toEqual(["cashondelivery", "Cash On Delivery", "229.00", "0.00", "30.00"]); // 199 + 20 shipping + 10 COD fee
  });

  it("turns credit memos into refunded item lines with the order number", async () => {
    const t = await magento.pull(creds, "credit_memo_lines", october, deps());
    expect(t.rows).toEqual([
      ["000000103", "000000501", "2026-10-08T10:00:00Z", "OUD-50", "Oud perfume 50 ml", "1.00", "285.00", "305.00", "AED"],
      ["000000106", "000000502", "2026-10-19T15:45:00Z", "SND-42", "Leather sandals, 42", "1.00", "199.00", "199.00", "AED"],
    ]);
  });

  it("gives one row per tracking number, with weight in kg", async () => {
    const t = await magento.pull(creds, "shipment_tracks", october, deps());
    const byAwb = t.rows.map((r) => `${r[0] || "(none)"} ${r[1]} ${r[5]}`);
    expect(byAwb).toEqual([
      "4410023301 000000101 1.00",
      "4410023302 000000102 0.90",
      "290118830 000000103 0.35",
      "4410023304 000000104 1.20",
      "4410023305 000000104 1.20",
      "290118836 000000106 1.25",
      "4410023307 000000107 0.60",
      "(none) 000000108 1.20",
    ]);
    expect(t.rows[0][6]).toBe("kgs");
    // Without Stores → Settings access the unit is assumed, and says so.
    const assumed = await magento.pull(creds, "shipment_tracks", october, deps({ deny: ["Magento_Backend::store"] }));
    expect(assumed.rows[0][6]).toBe("kgs (assumed)");
  });
});

describe("Magento data runs the webstore reconciliations", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "sawwi-magento-"));
    process.env.SAWWI_DATA_DIR = dir;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const mapped = async (runId: string, slot: string) => Object.fromEntries(((await buildRunView(runId))!.slots.find((s) => s.key === slot)!.file?.fields ?? []).map((x) => [x.key, x.column]));
  async function connection() {
    return (await store.listConnections("shop"))[0] ?? (await addConnection("shop", "magento", { ...DEMO_MAGENTO_CREDENTIALS }, null, deps()));
  }

  it("stores the token encrypted and labels the connection with the store", async () => {
    const conn = await connection();
    expect(conn.accountLabel).toBe("Sawwi Demo Store (demo-store.sawwi-mock.example)");
    expect(await store.getConnectionSecret("shop", conn.id)).not.toContain(DEMO_MAGENTO_CREDENTIALS.accessToken);
  });

  it("orders vs gateway: Magento orders map by name and reconcile against a card settlement file", async () => {
    const conn = await connection();
    const run = await runStore.createRun("shop", "web-orders-vs-gateway");
    await pullIntoRun(run, "orders", conn.id, "orders", october, { countries: ["AE"] }, deps());
    expect(await mapped(run.id, "orders")).toMatchObject({
      order_id: "Order ID", order_date: "Order date", order_status: "Order status", payment_method: "Payment method",
      order_total: "Order total", refunded_amount: "Refunded amount", shipping_amount: "Shipping charged", currency: "Currency",
    });

    // A made-up card gateway settlement for the same month: 108 captured 5 short, 110 not captured
    // yet, 103 and 106 refunded, and one capture for an order the store doesn't have.
    const gateway = [
      "Merchant order reference,Transaction ID,Type,Transaction date,Gross amount,Gateway fee,Net settled,Currency",
      "000000101,ch_101,capture,2026-10-01,495.00,14.36,480.64,AED",
      "000000103,ch_103,capture,2026-10-04,305.00,8.85,296.15,AED",
      "000000103,re_103,refund,2026-10-08,-305.00,0.00,-305.00,AED",
      "000000106,ch_106,capture,2026-10-12,484.00,14.04,469.96,AED",
      "000000106,re_106,refund,2026-10-19,-199.00,0.00,-199.00,AED",
      "000000108,ch_108,capture,2026-10-21,240.00,6.96,233.04,AED",
      "000000199,ch_199,capture,2026-10-28,150.00,4.35,145.65,AED",
    ].join("\n");
    await ingestFiles(run, "gateway", [{ name: "card-settlement-october.csv", data: new TextEncoder().encode(gateway) }], { countries: ["AE"] });
    expect((await buildRunView(run.id))!.openQuestions).toEqual([]);

    const result = await runReconciliation((await runStore.getRun(run.id))!, ["AE"]);
    expect(result.exceptions.map((e) => `${e.check}: ${e.key}`).sort()).toEqual([
      "amount_mismatch: 000000108",
      "paid_not_settled: 000000110",
      "settled_no_order: 000000199",
    ]);
  });

  it("refunds and shipments map onto the refunds and courier templates by name", async () => {
    const conn = await connection();
    const refunds = await runStore.createRun("shop", "web-refunds-vs-returns");
    await pullIntoRun(refunds, "refunds", conn.id, "credit_memo_lines", october, { countries: ["AE"] }, deps());
    expect(await mapped(refunds.id, "refunds")).toMatchObject({ order_id: "Order ID", refund_id: "Refund / credit memo ID", refund_date: "Refund date", sku: "SKU", qty: "Quantity", refund_amount: "Refund amount" });

    const freight = await runStore.createRun("shop", "web-courier-freight");
    await pullIntoRun(freight, "shipments", conn.id, "shipment_tracks", october, { countries: ["AE"] }, deps());
    expect(await mapped(freight.id, "shipments")).toMatchObject({ awb: "AWB / tracking number", order_id: "Order ID", declared_weight_kg: "Declared weight (kg)", ship_date: "Ship date" });
  });
});
