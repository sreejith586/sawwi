import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as runStore from "@/lib/runs/store";
import { buildRunView } from "@/lib/runs/view";
import { decryptSecret, encryptSecret } from "./crypto";
import fixtures from "./fixtures/shopify.json";
import { addConnection, pullIntoRun, validWindow } from "./service";
import { normaliseShop, shopify, SHOPIFY_API_VERSION, SHOPIFY_ORDER_COLUMNS, windowQuery } from "./shopify";
import * as store from "./store";
import { ConnectorError, type ConnectorDeps, type FetchLike } from "./types";

// Synthetic responses shaped like the Admin GraphQL API docs. Nothing here calls Shopify.

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };
function fakeShopify(replies: Reply[]) {
  const calls: { url: string; headers: Record<string, string>; body: { query: string; variables: Record<string, unknown> } }[] = [];
  const sleeps: number[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body ?? "{}") });
    const r = replies.shift();
    if (!r) throw new Error("Unexpected extra request");
    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: { get: (n: string) => r.headers?.[n] ?? null }, json: async () => r.body };
  };
  const deps: ConnectorDeps = { fetch, sleep: async (ms) => void sleeps.push(ms) };
  return { deps, calls, sleeps };
}

const creds = { shop: "desert-bloom.myshopify.com", accessToken: "shpat_test_0000000000000000000000" };
const window = { from: "2026-10-01", to: "2026-10-31" };

beforeAll(() => {
  process.env.SAWWI_CONNECTOR_KEY = randomBytes(32).toString("base64");
});

describe("secrets", () => {
  it("round-trips and binds the workspace as associated data", () => {
    const sealed = encryptSecret(creds, "sawwi:acme:shopify");
    expect(sealed).not.toContain("shpat_");
    expect(decryptSecret(sealed, "sawwi:acme:shopify")).toEqual(creds);
    expect(() => decryptSecret(sealed, "sawwi:other:shopify")).toThrow();
    expect(encryptSecret(creds, "x")).not.toBe(encryptSecret(creds, "x")); // fresh IV each time
  });
});

describe("Shopify connector", () => {
  it("accepts only myshopify.com stores", () => {
    expect(normaliseShop("Desert-Bloom")).toBe("desert-bloom.myshopify.com");
    expect(normaliseShop("https://desert-bloom.myshopify.com/admin")).toBe("desert-bloom.myshopify.com");
    expect(() => normaliseShop("evil.example.com")).toThrow(ConnectorError);
    expect(() => normaliseShop("169.254.169.254")).toThrow(ConnectorError);
    expect(() => shopify.parseCredentials({ shop: "x", accessToken: "short" })).toThrow(ConnectorError);
  });

  it("builds an inclusive UTC window query", () => {
    expect(windowQuery(window)).toBe("created_at:>='2026-10-01T00:00:00Z' AND created_at:<'2026-11-01T00:00:00Z'");
  });

  it("tests the token with a read-only shop query", async () => {
    const f = fakeShopify([{ status: 200, body: fixtures.shop }]);
    expect(await shopify.test(creds, f.deps)).toEqual({ accountLabel: "Desert Bloom Trading (desert-bloom.myshopify.com)" });
    expect(f.calls[0].url).toBe(`https://desert-bloom.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/graphql.json`);
    expect(f.calls[0].headers["X-Shopify-Access-Token"]).toBe(creds.accessToken);
  });

  it("pages through orders and returns fixed columns", async () => {
    const f = fakeShopify([
      { status: 200, body: fixtures.ordersPage1 },
      { status: 200, body: fixtures.ordersPage2 },
    ]);
    const table = await shopify.pull(creds, "orders", window, f.deps);
    expect(table.headers).toEqual([...SHOPIFY_ORDER_COLUMNS]);
    expect(table.rows).toHaveLength(4);
    expect(table.rows[0]).toEqual(["#1001", "2026-10-01T08:15:00Z", "2026-10-01T08:15:02Z", "paid", "fulfilled", "shopify_payments", "AED", "300.00", "0.0", "15.0", "15.00", "315.0", "0.0", "", "no"]);
    expect(table.rows[2][3]).toBe("partially refunded");
    expect(f.calls[0].body.variables).toMatchObject({ first: 250, after: null, query: windowQuery(window) });
    expect(f.calls[1].body.variables.after).toBe(fixtures.ordersPage1.data.orders.pageInfo.endCursor);
  });

  it("backs off on 429 and THROTTLED, then succeeds", async () => {
    const f = fakeShopify([
      { status: 429, headers: { "Retry-After": "2" } },
      { status: 200, body: { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] } },
      { status: 200, body: fixtures.ordersPage2 },
    ]);
    const table = await shopify.pull(creds, "orders", window, f.deps);
    expect(table.rows).toHaveLength(1);
    expect(f.sleeps).toEqual([2000, 2000]);
  });

  it("turns auth and scope failures into messages for the user", async () => {
    await expect(shopify.test(creds, fakeShopify([{ status: 401 }]).deps)).rejects.toThrow(/access token/);
    await expect(shopify.test(creds, fakeShopify([{ status: 403 }]).deps)).rejects.toThrow(/read_orders/);
    await expect(
      shopify.pull(creds, "orders", window, fakeShopify([{ status: 200, body: { errors: [{ message: "Access denied", extensions: { code: "ACCESS_DENIED" } }] } }]).deps),
    ).rejects.toThrow(/read_orders/);
    const busy = fakeShopify(Array.from({ length: 5 }, () => ({ status: 503 })));
    await expect(shopify.test(creds, busy.deps)).rejects.toThrow(/busy/);
  });
});

describe("connections feed the normal upload pipeline", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "sawwi-connectors-"));
    process.env.SAWWI_DATA_DIR = dir;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("stores the token encrypted, pulls orders into a run slot and maps them by name", async () => {
    const conn = await addConnection("acme", "shopify", { shop: "desert-bloom", accessToken: creds.accessToken }, null, fakeShopify([{ status: 200, body: fixtures.shop }]).deps);
    expect(conn.accountLabel).toBe("Desert Bloom Trading (desert-bloom.myshopify.com)");
    expect(store.getConnectionSecret("acme", conn.id)).not.toContain("shpat_");
    expect(store.getConnection("other", conn.id)).toBeUndefined();
    expect(JSON.stringify(store.listConnections("acme"))).not.toContain("shpat_");

    const run = runStore.createRun("acme", "web-orders-vs-gateway");
    const f = fakeShopify([
      { status: 200, body: fixtures.ordersPage1 },
      { status: 200, body: fixtures.ordersPage2 },
    ]);
    expect(await pullIntoRun(run, "orders", conn.id, "orders", window, { countries: ["AE"] }, f.deps)).toEqual({ rows: 4 });

    const slot = buildRunView(run.id)!.slots.find((s) => s.key === "orders")!;
    expect(slot.file?.name).toBe("shopify-orders-2026-10-01-to-2026-10-31.csv");
    expect(slot.file?.rowCount).toBe(4);
    const mapped = Object.fromEntries((slot.file?.fields ?? []).map((x) => [x.key, x.column]));
    expect(mapped).toMatchObject({ order_id: "Order", order_date: "Created at", order_total: "Total", refunded_amount: "Total refunded", payment_method: "Payment gateway", currency: "Currency" });

    const [sync] = store.listSyncs("acme");
    expect(sync).toMatchObject({ connectionId: conn.id, runId: run.id, slotKey: "orders", rows: 4, status: "ok" });
    expect(store.getConnection("acme", conn.id)!.lastSyncAt).not.toBeNull();
  });

  it("records failures and flags the connection when the provider refuses", async () => {
    const conn = store.listConnections("acme")[0];
    const run = runStore.createRun("acme", "web-orders-vs-gateway");
    await expect(pullIntoRun(run, "orders", conn.id, "orders", window, { countries: ["AE"] }, fakeShopify([{ status: 401 }]).deps)).rejects.toThrow(ConnectorError);
    expect(store.getConnection("acme", conn.id)).toMatchObject({ status: "needs_attention" });
    expect(store.listSyncs("acme")[0]).toMatchObject({ status: "failed", rows: 0 });

    // An empty period is reported but doesn't mark the connection as broken.
    const empty = { data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } };
    await expect(pullIntoRun(run, "orders", conn.id, "orders", window, { countries: ["AE"] }, fakeShopify([{ status: 200, body: empty }]).deps)).rejects.toThrow(/No orders/);
    expect(store.getConnection("acme", conn.id)).toMatchObject({ status: "connected" });

    await expect(pullIntoRun(run, "orders", "missing", "orders", window, { countries: ["AE"] })).rejects.toThrow(/no longer exists/);
    expect(validWindow({ from: "2026-10-31", to: "2026-10-01" })).toBe(false);
    expect(validWindow({ from: "2025-01-01", to: "2026-10-01" })).toBe(false);

    // Removing deletes the token; another workspace can't remove it; history stays.
    store.deleteConnection("other", conn.id);
    expect(store.getConnectionSecret("acme", conn.id)).toBeDefined();
    store.deleteConnection("acme", conn.id);
    expect(store.getConnectionSecret("acme", conn.id)).toBeUndefined();
    expect(store.listSyncs("acme").length).toBeGreaterThan(0);
  });
});
