import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRun, getRun } from "@/lib/runs/store";
import { runReconciliation } from "@/lib/runs/reconcile";
import { buildRunView } from "@/lib/runs/view";
import { decryptSecret } from "./crypto";
import { DEMO_NS_CREDENTIALS, mockNetSuite } from "./mock/netsuite";
import { DEMO_QBO_CREDENTIALS, DEMO_QBO_REALM, mockQuickBooks } from "./mock/quickbooks";
import { DEMO_XERO_CODE, DEMO_XERO_CREDENTIALS, DEMO_XERO_TENANT, mockXero } from "./mock/xero";
import { netsuite, normaliseAccount, nsHost, oauthHeader, pct, suiteql } from "./netsuite";
import { accessTokenFor, jwtClaims } from "./oauth";
import { checkOAuthState, redirectUriFor, startOAuth } from "./oauth-flow";
import { invoiceStatus, normaliseRealm, qboString, QBO_TOKEN_URL, quickbooks, reportQuery } from "./quickbooks";
import { addConnection, completeOAuthConnection, pullIntoRun } from "./service";
import * as store from "./store";
import { ConnectorError, type ConnectorDeps, type FetchLike } from "./types";
import { lineNet, pickTenant, xero, xeroDay, xeroWhere } from "./xero";

// QuickBooks Online, Xero and NetSuite (D-80 to D-85). Everything runs against in-process mocks
// (./mock) or scripted replies: nothing calls Intuit, Xero or Oracle.

const october = { from: "2026-10-01", to: "2026-10-31" };
const deps = (fetch: FetchLike, saved?: Record<string, string>[]): ConnectorDeps => ({ fetch, sleep: async () => {}, saveCredentials: saved ? async (c) => void saved.push(c) : undefined });

function scripted(replies: { status: number; body?: unknown; headers?: Record<string, string> }[]) {
  const sleeps: number[] = [];
  const urls: string[] = [];
  const fetch: FetchLike = async (url) => {
    urls.push(url);
    const r = replies.shift();
    if (!r) throw new Error("Unexpected extra request");
    return { ok: r.status < 300, status: r.status, headers: { get: (n: string) => r.headers?.[n] ?? null }, json: async () => r.body ?? {} };
  };
  return { deps: { fetch, sleep: async (ms: number) => void sleeps.push(ms) } as ConnectorDeps, sleeps, urls };
}

beforeAll(() => {
  process.env.SAWWI_CONNECTOR_KEY = randomBytes(32).toString("base64");
  process.env.SAWWI_QUICKBOOKS_CLIENT_ID = "qbo-app";
  process.env.SAWWI_QUICKBOOKS_CLIENT_SECRET = "qbo-secret";
  process.env.SAWWI_XERO_CLIENT_ID = "xero-app";
  process.env.SAWWI_XERO_CLIENT_SECRET = "xero-secret";
});

// ─── OAuth (D-81) ─────────────────────────────────────────────────────────────

describe("OAuth sign-in for QuickBooks and Xero", () => {
  it("keeps a valid access token, and refreshes an expired one, saving the rotated refresh token", async () => {
    const saved: Record<string, string>[] = [];
    const fresh = { ...DEMO_QBO_CREDENTIALS };
    const app = { clientId: "a", clientSecret: "b" };
    expect(await accessTokenFor(fresh, app, QBO_TOKEN_URL, deps(mockQuickBooks(), saved), "QuickBooks")).toBe(DEMO_QBO_CREDENTIALS.accessToken);
    expect(saved).toEqual([]);

    const expired = { ...DEMO_QBO_CREDENTIALS, expiresAt: String(Date.now() + 60_000) }; // within the 2-minute margin
    const mock = mockQuickBooks();
    expect(await accessTokenFor(expired, app, QBO_TOKEN_URL, deps(mock, saved), "QuickBooks")).toBe("demo-qbo-access-1");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ accessToken: "demo-qbo-access-1", refreshToken: "demo-qbo-refresh-1", realmId: DEMO_QBO_REALM });
    // The old refresh token was used up: refreshing with it again is refused, with a message to reconnect.
    const stale = { ...DEMO_QBO_CREDENTIALS, expiresAt: "0" };
    await expect(accessTokenFor(stale, app, QBO_TOKEN_URL, deps(mock), "QuickBooks")).rejects.toThrow(/expired or was revoked/);
    await expect(accessTokenFor(stale, null, QBO_TOKEN_URL, deps(mock), "QuickBooks")).rejects.toThrow(/isn't set up on this server/);
  });

  it("binds the callback to the browser, provider and workspace that started it", () => {
    expect(() => startOAuth("netsuite", "acme", true)).toThrow(/Unknown source/); // typed credentials, not OAuth
    expect(() => startOAuth("xero", "acme", false)).toThrow(/owners and admins/);
    const { url, cookie } = startOAuth("xero", "acme", true);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://login.xero.com/identity/connect/authorize");
    expect(u.searchParams.get("redirect_uri")).toBe(redirectUriFor("xero"));
    expect(u.searchParams.get("scope")).toContain("offline_access");
    expect(u.searchParams.get("scope")).not.toMatch(/\.read\b.*write|accounting\.transactions\b(?!\.read)/);
    const state = u.searchParams.get("state")!;
    expect(state.length).toBeGreaterThan(20);
    expect(() => checkOAuthState(cookie, "xero", "acme", state)).not.toThrow();
    for (const [c, p, o, s] of [
      [cookie, "xero", "acme", `${state}x`],
      [cookie, "quickbooks", "acme", state],
      [cookie, "xero", "other-org", state],
      [undefined, "xero", "acme", state],
      ["garbage", "xero", "acme", state],
    ] as const) {
      expect(() => checkOAuthState(c, p, o, s)).toThrow(ConnectorError);
    }
    const qbo = new URL(startOAuth("quickbooks", "acme", true).url);
    expect(qbo.origin).toBe("https://appcenter.intuit.com");
    expect(qbo.searchParams.get("scope")).toBe("com.intuit.quickbooks.accounting");
    delete process.env.SAWWI_XERO_CLIENT_ID;
    expect(() => startOAuth("xero", "acme", true)).toThrow(/SAWWI_XERO_CLIENT_ID/);
    process.env.SAWWI_XERO_CLIENT_ID = "xero-app";
  });

  it("reads JWT claims without trusting them for anything but picking the tenant", () => {
    expect(jwtClaims(`a.${Buffer.from('{"authentication_event_id":"e1"}').toString("base64url")}.c`)).toEqual({ authentication_event_id: "e1" });
    expect(jwtClaims("not-a-jwt")).toEqual({});
  });
});

// ─── QuickBooks Online (D-82) ─────────────────────────────────────────────────

describe("QuickBooks Online connector", () => {
  const creds = quickbooks.parseCredentials({ ...DEMO_QBO_CREDENTIALS });

  it("validates the realm and builds safe queries", () => {
    expect(normaliseRealm(" 9341450000000001 ")).toBe("9341450000000001");
    for (const bad of ["", "abc", "123/../456", "1".repeat(21)]) expect(() => normaliseRealm(bad)).toThrow(ConnectorError);
    expect(() => quickbooks.parseCredentials({ realmId: "1" })).toThrow(/Connect with QuickBooks/);
    expect(quickbooks.parseCredentials({ ...DEMO_QBO_CREDENTIALS, environment: "evil" }).environment).toBe("production");
    expect(qboString("O'Brien \\ Co")).toBe("'O\\'Brien \\\\ Co'");
    expect(reportQuery({ entity: "Invoice", dated: true }, october)).toBe("SELECT * FROM Invoice WHERE TxnDate >= '2026-10-01' AND TxnDate <= '2026-10-31' ORDERBY TxnDate");
    expect([invoiceStatus(100, 0), invoiceStatus(100, 40), invoiceStatus(100, 100)]).toEqual(["Paid", "Partially paid", "Open"]);
  });

  it("swaps the sign-in code for tokens and the company's realm", async () => {
    const { deps: d, urls } = scripted([{ status: 200, body: { access_token: "a1", refresh_token: "r1", expires_in: 3600 } }]);
    const app = quickbooks.oauth!.app()!;
    const c = await quickbooks.oauth!.complete(app, new URLSearchParams({ code: "abc", realmId: DEMO_QBO_REALM, state: "s" }), "https://sawwiapp.ai/cb", d);
    expect(c).toMatchObject({ accessToken: "a1", refreshToken: "r1", realmId: DEMO_QBO_REALM, environment: "production" });
    expect(urls).toEqual([QBO_TOKEN_URL]);
    await expect(quickbooks.oauth!.complete(app, new URLSearchParams({ code: "abc", realmId: "x" }), "u", d)).rejects.toThrow(/realm/);
  });

  it("pulls invoices, lines, credit memos, POs, bills and products in the shapes the templates map", async () => {
    const log: { method: string; url: string }[] = [];
    const d = deps(mockQuickBooks({ log }));
    expect(await quickbooks.test(creds, d)).toEqual({ accountLabel: "Sawwi Demo Distribution LLC (Sandbox)" });

    const inv = await quickbooks.pull(creds, "sales_invoices", october, d);
    expect(inv.rows.map((r) => `${r[0]} ${r[8]} ${r[9]} ${r[10]}`)).toEqual(["INV-2040 3307.50 0.00 Paid", "INV-2041 3570.00 2570.00 Partially paid", "INV-2042 2205.00 2205.00 Open", "INV-2043 630.00 630.00 Open"]);
    expect(inv.rows[0]).toEqual(["INV-2040", "C-100", "Gulf Retail Group", "2026-10-02", "2026-11-01", "AED", "3150.00", "157.50", "3307.50", "0.00", "Paid"]);

    const lines = await quickbooks.pull(creds, "sales_invoice_lines", october, d);
    expect(lines.rows).toHaveLength(6); // subtotal lines left out
    expect(lines.rows.find((r) => r[0] === "INV-2041")).toEqual(["INV-2041", "2026-10-09", "C-101", "Emirates Office Supplies", "MON-270", "27in monitor", "4.00", "850.00", "3400.00", "AED"]);

    const cm = await quickbooks.pull(creds, "sales_credit_memos", october, d);
    expect(cm.rows).toEqual([["CN-301", "2026-10-20", "C-100", "Gulf Retail Group", "AED", "190.00", "9.50", "199.50", "199.50"]]);

    const po = await quickbooks.pull(creds, "purchase_order_lines", october, d);
    expect(po.rows.map((r) => `${r[0]} ${r[5]} ${r[7]} ${r[8]} ${r[11]}`)).toEqual(["PO-7701 KBD-110 50.00 52.00 Closed", "PO-7702 MON-270 12.00 610.00 Open"]);

    const bills = await quickbooks.pull(creds, "purchase_invoice_lines", october, d);
    expect(bills.rows.map((r) => `${r[0]} ${r[2]} ${r[5]} ${r[7]} ${r[8]}`)).toEqual(["SZP-55120 PO-7701 KBD-110 50.00 52.00", "BILL-ZX-88 PO-7702 MON-270 10.00 612.00"]); // PO ids looked up as numbers

    const items = await quickbooks.pull(creds, "items", { from: "2030-01-01", to: "2030-01-31" }, d);
    expect(items.rows.map((r) => `${r[0]} ${r[3]}`)).toEqual(["DST-100 64.00", "CBL-200 410.00", "MON-270 18.00", "KBD-110 37.00", "MSE-120 52.00", "SRV-INST 0.00"]);

    expect(log.every((l) => l.method === "GET" && l.url.startsWith(`https://sandbox-quickbooks.api.intuit.com/v3/company/${DEMO_QBO_REALM}/`))).toBe(true);
    expect(log.every((l) => l.url.includes("minorversion="))).toBe(true);
  });

  it("pages 1,000 rows at a time, retries when throttled, and explains a fault", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ Id: String(i), DocNumber: `I-${i}`, TotalAmt: 1, Balance: 0, Line: [] }));
    const seen: string[] = [];
    const waits: number[] = [];
    let throttled = false;
    const byUrl: FetchLike = async (url) => {
      seen.push(decodeURIComponent(url));
      const ok = (body: unknown) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });
      if (url.includes("Preferences")) return ok({ QueryResponse: { Preferences: [{ CurrencyPrefs: { HomeCurrency: { value: "AED" } } }] } });
      if (!throttled) {
        throttled = true;
        return { ok: false, status: 429, headers: { get: (n: string) => (n === "Retry-After" ? "3" : null) }, json: async () => ({}) };
      }
      if (url.includes("STARTPOSITION%201%20")) return ok({ QueryResponse: { Invoice: full } });
      return ok({ QueryResponse: { Invoice: [{ Id: "x", DocNumber: "LAST", TotalAmt: 5, Balance: 5 }] } });
    };
    const paged = await quickbooks.pull(creds, "sales_invoices", october, { fetch: byUrl, sleep: async (ms) => void waits.push(ms) });
    expect(paged.rows).toHaveLength(1001);
    expect(paged.rows.at(-1)!.slice(0, 1)).toEqual(["LAST"]);
    expect(seen.filter((u) => u.includes("FROM Invoice")).map((u) => /STARTPOSITION (\d+)/.exec(u)![1])).toEqual(["1", "1", "1001"]);
    expect(waits).toEqual([3000]);

    const fault = scripted([{ status: 400, body: { Fault: { Error: [{ Message: "Invalid query", Detail: "QueryParserError: bad" }] } } }]);
    await expect(quickbooks.pull(creds, "sales_invoices", october, fault.deps)).rejects.toThrow("QuickBooks: QueryParserError: bad");
    const denied = scripted([{ status: 401 }]);
    await expect(quickbooks.pull(creds, "sales_invoices", october, denied.deps)).rejects.toThrow(/connect again/);
  });
});

// ─── Xero (D-83) ──────────────────────────────────────────────────────────────

describe("Xero connector", () => {
  const creds = xero.parseCredentials({ ...DEMO_XERO_CREDENTIALS });

  it("connects one organisation per sign-in", () => {
    const org = (tenantId: string, authEventId = "e1") => ({ tenantId, tenantType: "ORGANISATION", tenantName: tenantId, authEventId });
    const a = "11111111-1111-4111-8111-111111111111";
    const b = "22222222-2222-4222-8222-222222222222";
    expect(pickTenant([org(a), org(b, "older")], "e1")).toEqual({ tenantId: a, tenantName: a });
    expect(pickTenant([org(a)], "")).toEqual({ tenantId: a, tenantName: a }); // no claim: the only one
    expect(() => pickTenant([org(a), org(b)], "e1")).toThrow(/Pick one organisation/);
    expect(() => pickTenant([{ tenantId: a, tenantType: "PRACTICE", authEventId: "e1" }], "e1")).toThrow(/No Xero organisation/);
    expect(() => pickTenant([org("not-a-guid")], "e1")).toThrow(/No Xero organisation/);
    expect(() => xero.parseCredentials({ refreshToken: "r", tenantId: "../x" })).toThrow(/Connect with Xero/);
  });

  it("builds Xero's where filter and reads both date formats", () => {
    expect(xeroWhere("ACCREC", october)).toBe('Type=="ACCREC" AND Date>=DateTime(2026, 10, 01) AND Date<=DateTime(2026, 10, 31)');
    expect(xeroDay({ DateString: "2026-10-03T00:00:00" }, "Date")).toBe("2026-10-03");
    expect(xeroDay({ Date: "/Date(1791072000000+0000)/" }, "Date")).toBe("2026-10-04");
    expect(xeroDay({}, "Date")).toBe("");
    expect(lineNet({ LineAmountTypes: "Inclusive" }, { LineAmount: 105, TaxAmount: 5 })).toBe(100);
    expect(lineNet({ LineAmountTypes: "Exclusive" }, { LineAmount: 100, TaxAmount: 5 })).toBe(100);
  });

  it("swaps the code for tokens and finds the organisation this sign-in connected", async () => {
    const c = await xero.oauth!.complete(xero.oauth!.app()!, new URLSearchParams({ code: DEMO_XERO_CODE }), "https://sawwiapp.ai/cb", deps(mockXero()));
    expect(c).toMatchObject({ tenantId: DEMO_XERO_TENANT, tenantName: "Sawwi Demo Distribution LLC", refreshToken: "demo-xero-refresh-1" });
    await expect(xero.oauth!.complete(xero.oauth!.app()!, new URLSearchParams({ code: "wrong" }), "u", deps(mockXero()))).rejects.toThrow(/expired or was revoked/);
  });

  it("pulls posted documents only, page by page, in the shapes the templates map", async () => {
    const log: { method: string; url: string }[] = [];
    const d = deps(mockXero({ log, pageSize: 2 }));
    expect(await xero.test(creds, d)).toEqual({ accountLabel: "Sawwi Demo Distribution LLC" });

    const inv = await xero.pull(creds, "sales_invoices", october, d);
    expect(inv.rows.map((r) => `${r[0]} ${r[9]} ${r[10]} ${r[11]}`)).toEqual(["INV-2040 3307.50 0.00 PAID", "INV-2041 3570.00 2570.00 AUTHORISED", "INV-2042 2205.00 2205.00 AUTHORISED", "INV-2043 630.00 630.00 AUTHORISED"]); // draft INV-2099 left out
    expect(inv.rows[0]).toEqual(["INV-2040", "GRG-PO-551", "C-100", "Gulf Retail Group", "2026-10-02", "2026-11-01", "AED", "3150.00", "157.50", "3307.50", "0.00", "PAID"]);
    expect(log.filter((l) => l.url.includes("/Invoices?")).map((l) => new URL(l.url).searchParams.get("page"))).toEqual(["1", "2"]);

    const lines = await xero.pull(creds, "sales_invoice_lines", october, d);
    expect(lines.rows.find((r) => r[0] === "INV-2040" && r[4] === "CBL-200")).toEqual(["INV-2040", "2026-10-02", "C-100", "Gulf Retail Group", "CBL-200", "USB-C cable 2m", "30.00", "25.00", "0.00", "750.00", "37.50", "AED"]);

    const cn = await xero.pull(creds, "sales_credit_memos", october, d);
    expect(cn.rows).toEqual([["CN-301", "2026-10-20", "INV-2042", "C-100", "Gulf Retail Group", "AED", "190.00", "9.50", "199.50", "199.50", "AUTHORISED"]]);

    const po = await xero.pull(creds, "purchase_order_lines", october, d);
    expect(po.rows.map((r) => `${r[0]} ${r[4]} ${r[5]} ${r[11]}`)).toEqual(["PO-7701 2026-10-10 KBD-110 BILLED", "PO-7702 2026-10-22 MON-270 AUTHORISED"]);

    const bills = await xero.pull(creds, "purchase_invoice_lines", october, d);
    expect(bills.rows.map((r) => `${r[0]} ${r[2]} ${r[8]}`)).toEqual(["SZP-55120 PO-7701 52.00", "BILL-ZX-88 PO-7702 612.00"]);

    const items = await xero.pull(creds, "items", october, d);
    expect(items.rows.find((r) => r[0] === "SRV-INST")).toEqual(["SRV-INST", "Installation service", "No", "0.00", "600.00"]);

    expect(log.every((l) => l.method === "GET")).toBe(true);
  });

  it("refuses another organisation's data and waits as told when throttled", async () => {
    await expect(xero.pull({ ...creds, tenantId: "33333333-3333-4333-8333-333333333333" }, "sales_invoices", october, deps(mockXero()))).rejects.toThrow(/disconnected/);
    const { deps: d, sleeps } = scripted([
      { status: 429, headers: { "Retry-After": "7" } },
      { status: 200, body: { Organisations: [{ Name: "X", BaseCurrency: "AED" }] } },
    ]);
    expect(await xero.test(creds, d)).toEqual({ accountLabel: "X" });
    expect(sleeps).toEqual([7000]);
    const bad = scripted([{ status: 400, body: { Elements: [{ ValidationErrors: [{ Message: "Invalid where clause" }] }] } }]);
    await expect(xero.test(creds, bad.deps)).rejects.toThrow("Xero: Invalid where clause");
  });
});

// ─── NetSuite (D-84) ──────────────────────────────────────────────────────────

describe("NetSuite connector", () => {
  const creds = netsuite.parseCredentials({ ...DEMO_NS_CREDENTIALS });

  it("validates the account so the host can't be redirected", () => {
    expect(normaliseAccount("1234567")).toBe("1234567");
    expect(normaliseAccount(" 1234567-sb1 ")).toBe("1234567_SB1");
    expect(normaliseAccount("1234567_rp")).toBe("1234567_RP");
    for (const bad of ["evil.com", "1234567.x", "", "12", "1234567_XX1"]) expect(() => normaliseAccount(bad)).toThrow(ConnectorError);
    expect(nsHost("1234567_SB1")).toBe("https://1234567-sb1.suitetalk.api.netsuite.com");
    expect(() => netsuite.parseCredentials({ ...DEMO_NS_CREDENTIALS, tokenSecret: "short" })).toThrow(/token secret/);
  });

  it("signs requests with OAuth 1.0a HMAC-SHA256, query parameters included", () => {
    expect(pct("a b!*'()~")).toBe("a%20b%21%2A%27%28%29~");
    const url = "https://9990001-sb1.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=1000&offset=0";
    const h = oauthHeader(creds, "POST", url, "nonce123", "1790000000");
    expect(h).toMatch(/^OAuth realm="9990001_SB1", oauth_consumer_key="c{64}", oauth_nonce="nonce123", oauth_signature_method="HMAC-SHA256", oauth_timestamp="1790000000", oauth_token="e{64}", oauth_version="1.0", oauth_signature="[A-Za-z0-9%]+"$/);
    expect(oauthHeader(creds, "POST", url, "nonce123", "1790000000")).toBe(h); // deterministic
    expect(oauthHeader(creds, "POST", url.replace("offset=0", "offset=1000"), "nonce123", "1790000000")).not.toBe(h); // the query is signed
  });

  it("pulls every report through SuiteQL with NetSuite's signs undone", async () => {
    const log: { method: string; url: string; body?: string }[] = [];
    const d = deps(mockNetSuite({ log }));
    expect(await netsuite.test(creds, d)).toEqual({ accountLabel: "NetSuite 9990001_SB1 (Sandbox)" });

    const inv = await netsuite.pull(creds, "sales_invoices", october, d);
    expect(inv.rows[0]).toEqual(["INV-2040", "GRG-PO-551", "C-100", "Gulf Retail Group", "2026-10-02", "2026-11-01", "AED", "3307.50", "0.00", "Paid In Full"]);
    const lines = await netsuite.pull(creds, "sales_invoice_lines", october, d);
    expect(lines.rows[0]).toEqual(["INV-2040", "2026-10-02", "C-100", "Gulf Retail Group", "SO-880", "DST-100", "Desk stand, aluminium", "20.00", "120.00", "2400.00", "AED"]);
    const cm = await netsuite.pull(creds, "sales_credit_memos", october, d);
    expect(cm.rows).toEqual([["CN-301", "2026-10-20", "INV-2042", "C-100", "Gulf Retail Group", "AED", "199.50", "199.50", "Open"]]);
    expect((await netsuite.pull(creds, "sales_order_lines", october, d)).rows).toHaveLength(5);
    expect((await netsuite.pull(creds, "sales_shipment_lines", october, d)).rows[0]).toEqual(["IF-880", "SO-880", "2026-10-02", "C-100", "Gulf Retail Group", "DST-100", "Desk stand, aluminium", "20.00"]);
    expect((await netsuite.pull(creds, "items", october, d)).rows).toHaveLength(5); // inventory items only

    const sql = log.map((l) => JSON.parse(l.body ?? "{}").q as string);
    expect(sql.every((q) => !/;|--/.test(q))).toBe(true);
    expect(sql.find((q) => q.includes("'CustInvc'"))).toContain("TO_DATE('2026-10-01', 'YYYY-MM-DD')");
    expect(log.every((l) => l.method === "POST" && l.url.startsWith("https://9990001-sb1.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?"))).toBe(true);
  });

  it("pages with offset, and explains a rejected token or a role without access", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ links: [], tranid: `I-${i}` }));
    const { deps: d, urls } = scripted([
      { status: 200, body: { items: full, hasMore: true } },
      { status: 200, body: { items: [{ tranid: "LAST" }], hasMore: false } },
    ]);
    const rows = await suiteql(creds, d, "SELECT tranid FROM transaction");
    expect(rows).toHaveLength(1001);
    expect(rows[0]).toEqual({ tranid: "I-0" }); // links dropped
    expect(urls.map((u) => new URL(u).searchParams.get("offset"))).toEqual(["0", "1000"]);

    const wrongSecret = { ...creds, tokenSecret: "0".repeat(64) };
    await expect(netsuite.test(wrongSecret, deps(mockNetSuite()))).rejects.toThrow(/Log in using Access Tokens/);
    const noRole = scripted([{ status: 403, body: { "o:errorDetails": [{ detail: "Record 'transaction' not found or no permission." }] } }]);
    await expect(netsuite.pull(creds, "sales_invoices", october, noRole.deps)).rejects.toThrow(/no permission/);
  });
});

// ─── Through the service: saved connections, rotated tokens, a reconciliation ─

describe("Accounting connections in a workspace", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "sawwi-acct-"));
    process.env.SAWWI_DATA_DIR = dir;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  beforeEach(() => {
    process.env.SAWWI_XERO_CLIENT_ID = "xero-app";
  });

  it("connects Xero through the callback once, and a second sign-in replaces its tokens", async () => {
    const mock = mockXero();
    const first = await completeOAuthConnection("acme", "xero", new URLSearchParams({ code: DEMO_XERO_CODE }), "u", null, deps(mock));
    expect(first.accountLabel).toBe("Sawwi Demo Distribution LLC");
    const second = await completeOAuthConnection("acme", "xero", new URLSearchParams({ code: DEMO_XERO_CODE }), "u", null, deps(mock));
    expect(second.id).toBe(first.id);
    expect((await store.listConnections("acme")).filter((c) => c.provider === "xero")).toHaveLength(1);
    const sealed = (await store.getConnectionSecret("acme", first.id))!;
    expect(sealed).not.toContain("demo-xero-refresh");
    expect(decryptSecret<Record<string, string>>(sealed, "sawwi:acme:xero").refreshToken).toBe("demo-xero-refresh-2");
    await expect(completeOAuthConnection("acme", "xero", new URLSearchParams({ error: "access_denied" }), "u", null, deps(mock))).rejects.toThrow(/wasn't granted/);
    await expect(addConnection("acme", "xero", {}, null, deps(mock))).rejects.toThrow(/Connect with Xero/);
  });

  it("saves the rotated refresh token when a pull renews the sign-in", async () => {
    const mock = mockXero({ refreshTokens: ["r-old"] });
    const conn = await completeOAuthConnection("rotate", "xero", new URLSearchParams({ code: DEMO_XERO_CODE }), "u", null, deps(mock));
    // Age the stored access token, as if half an hour had passed.
    const aged = { ...decryptSecret<Record<string, string>>((await store.getConnectionSecret("rotate", conn.id))!, "sawwi:rotate:xero"), expiresAt: "0" };
    const { encryptSecret } = await import("./crypto");
    await store.updateConnectionSecret("rotate", conn.id, encryptSecret(aged, "sawwi:rotate:xero"));
    const run = await createRun("rotate", "b2b-cash-application");
    await pullIntoRun(run, "invoices", conn.id, "sales_invoices", october, { countries: ["AE"] }, deps(mock));
    const after = decryptSecret<Record<string, string>>((await store.getConnectionSecret("rotate", conn.id))!, "sawwi:rotate:xero");
    expect(after.refreshToken).toBe("demo-xero-refresh-2"); // the code gave -1, the refresh -2
    expect(Number(after.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("NetSuite fills the three-way match: every field maps by name and the planted exceptions are found", async () => {
    const conn = await addConnection("ns", "netsuite", { ...DEMO_NS_CREDENTIALS }, null, deps(mockNetSuite()));
    expect(await store.getConnectionSecret("ns", conn.id)).not.toContain(DEMO_NS_CREDENTIALS.tokenSecret);
    const run = await createRun("ns", "p2p-three-way-match");
    for (const [slot, report] of Object.entries({ po: "purchase_order_lines", grn: "purchase_receipt_lines", invoices: "purchase_invoice_lines" })) {
      await pullIntoRun(run, slot, conn.id, report, october, { countries: ["AE"] }, deps(mockNetSuite()));
    }
    const view = (await buildRunView(run.id))!;
    expect(view.openQuestions).toEqual([]);
    const mapped = (slot: string) => Object.fromEntries((view.slots.find((s) => s.key === slot)!.file?.fields ?? []).map((x) => [x.key, x.column]));
    expect(mapped("po")).toMatchObject({ po_no: "PO number", supplier: "Supplier", sku: "SKU", qty_ordered: "Qty ordered", po_price: "PO unit price (excl. VAT)" });
    expect(mapped("grn")).toMatchObject({ grn_no: "GRN number", po_no: "PO number", qty_received: "Qty received" });
    expect(mapped("invoices")).toMatchObject({ invoice_no: "Supplier invoice no.", po_no: "PO number", qty_invoiced: "Qty invoiced" });
    const result = await runReconciliation((await getRun(run.id))!, ["AE"]);
    const found = result.exceptions.map((e) => `${e.check}: ${e.key}`).sort();
    expect(found).toContain("price_above_po: PO-7702 / MON-270");
    expect(found).toContain("short_received: PO-7702 / MON-270");
    expect(found.filter((f) => f.includes("PO-7701"))).toEqual([]); // ordered, received and billed alike
  });

  it("QuickBooks and Xero invoices map onto cash application by name", async () => {
    const qbo = await addConnectionFor("quickbooks");
    const xeroMock = mockXero(); // the tokens it issues on sign-in are the ones it accepts
    const x = await completeOAuthConnection("cash", "xero", new URLSearchParams({ code: DEMO_XERO_CODE }), "u", null, deps(xeroMock));
    for (const [id, d] of [
      [qbo, deps(mockQuickBooks())],
      [x.id, deps(xeroMock)],
    ] as const) {
      const run = await createRun("cash", "b2b-cash-application");
      await pullIntoRun(run, "invoices", id, "sales_invoices", october, { countries: ["AE"] }, d);
      const view = (await buildRunView(run.id))!;
      const inv = Object.fromEntries((view.slots.find((s) => s.key === "invoices")!.file?.fields ?? []).map((f) => [f.key, f.column]));
      expect(inv).toMatchObject({ invoice_no: "Invoice number", customer: "Customer", invoice_date: "Invoice date", due_date: "Due date", invoice_amount: "Invoice amount (incl. VAT)", open_amount: "Open amount" });
    }
  });
});

/** A QuickBooks connection saved directly (its sign-in is covered above). */
async function addConnectionFor(provider: "quickbooks"): Promise<string> {
  const { encryptSecret } = await import("./crypto");
  const creds = quickbooks.parseCredentials({ ...DEMO_QBO_CREDENTIALS });
  const c = await store.insertConnection({ orgKey: "cash", provider, accountLabel: "Sawwi Demo Distribution LLC (Sandbox)", secretEnc: encryptSecret(creds, "sawwi:cash:quickbooks"), createdBy: null });
  return c.id;
}
