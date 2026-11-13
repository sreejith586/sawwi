import { QBO_API_HOSTS, QBO_TOKEN_URL } from "../quickbooks";
import type { FetchLike } from "../types";
import { DEMO_ACCOUNTING_COMPANY, DEMO_ACCOUNTING_CURRENCY, DEMO_BILLS, DEMO_CREDIT_NOTES, DEMO_ITEMS, DEMO_PURCHASE_ORDERS, DEMO_SALES_INVOICES, docTotal, docVat, inWindow, lineNet, type DemoLine } from "./accounting-data";

// An in-process stand-in for one invented QuickBooks Online sandbox company (D-85). It answers
// the token endpoint (refresh only), companyinfo and the query endpoint for the entities the
// connector reads, in Intuit's JSON shapes, so tests and the demo run the real connector with no
// network and no real token. Only the demo realm and the demo tokens are accepted.

export const DEMO_QBO_REALM = "9341450000000001";
const DEMO_ACCESS = "demo-only-qbo-access-token";
export const DEMO_QBO_CREDENTIALS = {
  accessToken: DEMO_ACCESS,
  refreshToken: "demo-only-qbo-refresh-token",
  expiresAt: String(Date.UTC(2100, 0, 1)),
  realmId: DEMO_QBO_REALM,
  environment: "sandbox",
};

const ROOT = `${QBO_API_HOSTS.sandbox}/v3/company/${DEMO_QBO_REALM}/`;
export const isQuickBooksMockUrl = (url: string) => url.startsWith(`${QBO_API_HOSTS.sandbox}/`) || url === QBO_TOKEN_URL;

type Doc = Record<string, unknown>;
const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body });
const fault = (status: number, message: string) => reply(status, { Fault: { Error: [{ Message: message, Detail: message }], type: "ValidationFault" } });

const ref = (value: string, name: string) => ({ value, name });
const AED = ref(DEMO_ACCOUNTING_CURRENCY, "UAE Dirham");
const item = (sku: string) => ref(String(DEMO_ITEMS.findIndex((i) => i.sku === sku) + 1), sku);
const salesLines = (lines: DemoLine[]) => [
  ...lines.map((l, i) => ({ Id: String(i + 1), LineNum: i + 1, Description: l.description, Amount: lineNet(l), DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: item(l.sku), Qty: l.qty, UnitPrice: l.price, TaxCodeRef: { value: "5" } } })),
  { Amount: lines.reduce((s, l) => s + lineNet(l), 0), DetailType: "SubTotalLineDetail", SubTotalLineDetail: {} },
];
const purchaseLines = (lines: DemoLine[], links: Doc[] = []) =>
  lines.map((l, i) => ({ Id: String(i + 1), Description: l.description, Amount: lineNet(l), DetailType: "ItemBasedExpenseLineDetail", ItemBasedExpenseLineDetail: { ItemRef: item(l.sku), Qty: l.qty, UnitPrice: l.price }, LinkedTxn: links }));

const PO_ID = (number: string) => String(100 + DEMO_PURCHASE_ORDERS.findIndex((p) => p.number === number));

const ENTITIES: Record<string, Doc[]> = {
  Invoice: DEMO_SALES_INVOICES.map((d, i) => {
    const total = docTotal(d.lines);
    return { Id: String(10 + i), DocNumber: d.number, TxnDate: d.date, DueDate: d.due, CustomerRef: ref(d.customerNo, d.customer), CurrencyRef: AED, TotalAmt: total, Balance: Math.round((total - d.paid) * 100) / 100, TxnTaxDetail: { TotalTax: docVat(d.lines) }, Line: salesLines(d.lines) };
  }),
  CreditMemo: DEMO_CREDIT_NOTES.map((d, i) => ({ Id: String(50 + i), DocNumber: d.number, TxnDate: d.date, CustomerRef: ref(d.customerNo, d.customer), CurrencyRef: AED, TotalAmt: docTotal(d.lines), Balance: docTotal(d.lines), TxnTaxDetail: { TotalTax: docVat(d.lines) }, Line: salesLines(d.lines) })),
  PurchaseOrder: DEMO_PURCHASE_ORDERS.map((d) => ({ Id: PO_ID(d.number), DocNumber: d.number, TxnDate: d.date, DueDate: d.expected, VendorRef: ref(d.vendorNo, d.vendor), CurrencyRef: AED, POStatus: d.status === "Fully Billed" ? "Closed" : "Open", TotalAmt: docTotal(d.lines), Line: purchaseLines(d.lines) })),
  Bill: DEMO_BILLS.map((d, i) => ({ Id: String(200 + i), DocNumber: d.number, TxnDate: d.date, VendorRef: ref(d.vendorNo, d.vendor), CurrencyRef: AED, TotalAmt: docTotal(d.lines), Line: purchaseLines(d.lines, [{ TxnId: PO_ID(d.po), TxnType: "PurchaseOrder" }]) })),
  Item: DEMO_ITEMS.map((d, i) => ({ Id: String(i + 1), Name: d.sku, Sku: d.sku, Description: d.name, Type: d.tracked ? "Inventory" : "Service", Active: true, UnitPrice: d.price, ...(d.tracked ? { QtyOnHand: d.onHand } : {}) })),
  Preferences: [{ CurrencyPrefs: { MultiCurrencyEnabled: false, HomeCurrency: { value: DEMO_ACCOUNTING_CURRENCY } } }],
};

export type MockQuickBooksOptions = { log?: { method: string; url: string }[]; /** Refresh tokens the token endpoint accepts. */ refreshTokens?: string[] };

export function mockQuickBooks(options: MockQuickBooksOptions = {}): FetchLike {
  const accessTokens = new Set([DEMO_ACCESS]);
  const refreshTokens = new Set(options.refreshTokens ?? [DEMO_QBO_CREDENTIALS.refreshToken]);
  let issued = 0;
  return async (url, init) => {
    options.log?.push({ method: init.method, url });
    if (url === QBO_TOKEN_URL) {
      const form = new URLSearchParams(init.body ?? "");
      if (!init.headers.Authorization?.startsWith("Basic ")) return reply(401, { error: "invalid_client" });
      if (form.get("grant_type") !== "refresh_token" || !refreshTokens.delete(form.get("refresh_token") ?? "")) return reply(400, { error: "invalid_grant" });
      issued++;
      const access = `demo-qbo-access-${issued}`;
      accessTokens.add(access);
      refreshTokens.add(`demo-qbo-refresh-${issued}`);
      return reply(200, { access_token: access, refresh_token: `demo-qbo-refresh-${issued}`, expires_in: 3600, token_type: "bearer", x_refresh_token_expires_in: 8_726_400 });
    }
    if (init.method !== "GET") return fault(405, "The demo company is read-only.");
    if (!accessTokens.has((init.headers.Authorization ?? "").replace(/^Bearer /, ""))) return reply(401, { fault: { error: [{ message: "AuthenticationFailed" }] } });
    if (!url.startsWith(ROOT)) return fault(403, "ApplicationAuthorizationFailed");
    const u = new URL(url);
    const path = u.pathname.slice(new URL(ROOT).pathname.length);
    if (path === `companyinfo/${DEMO_QBO_REALM}`) return reply(200, { CompanyInfo: { CompanyName: DEMO_ACCOUNTING_COMPANY, Country: "AE" } });
    if (path !== "query") return fault(400, `The mock doesn't serve ${path}`);
    return reply(200, { QueryResponse: runQuery(u.searchParams.get("query") ?? ""), time: "2026-11-01T00:00:00Z" });
  };
}

/** Just enough of Intuit's query language for the connector's queries. */
function runQuery(sql: string): Doc {
  const entity = /FROM (\w+)/i.exec(sql)?.[1] ?? "";
  let rows = ENTITIES[entity];
  if (!rows) throw new Error(`The mock has no ${entity}`);
  const from = /TxnDate >= '([\d-]+)'/.exec(sql)?.[1];
  const to = /TxnDate <= '([\d-]+)'/.exec(sql)?.[1];
  if (from && to) rows = rows.filter((r) => inWindow(String(r.TxnDate), from, to));
  const ids = /Id IN \(([^)]*)\)/.exec(sql)?.[1];
  if (ids) {
    const wanted = ids.split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
    rows = rows.filter((r) => wanted.includes(String(r.Id)));
  }
  const start = Number(/STARTPOSITION (\d+)/.exec(sql)?.[1] ?? 1);
  const max = Number(/MAXRESULTS (\d+)/.exec(sql)?.[1] ?? 100);
  const page = rows.slice(start - 1, start - 1 + max);
  return page.length ? { [entity]: page, startPosition: start, maxResults: page.length } : {};
}
