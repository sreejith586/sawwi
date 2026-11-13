import { createHmac } from "node:crypto";
import { nsHost } from "../netsuite";
import type { FetchLike } from "../types";
import { DEMO_ACCOUNTING_CURRENCY, DEMO_BILLS, DEMO_CREDIT_NOTES, DEMO_ITEMS, DEMO_PURCHASE_ORDERS, DEMO_RECEIPTS, DEMO_SALES_INVOICES, docTotal, inWindow, lineNet } from "./accounting-data";

// An in-process stand-in for one invented NetSuite sandbox account's SuiteQL endpoint (D-85).
// It can't run SQL: it recognises each of the connector's queries by transaction type and date
// window and returns the rows NetSuite would (lowercase columns, NetSuite's signs: sales lines
// negative), with limit/offset paging. It checks the OAuth 1.0a signature with its own code,
// so a signing mistake in the connector fails the tests. Only the demo token is accepted.

export const DEMO_NS_CREDENTIALS = {
  accountId: "9990001_SB1",
  consumerKey: "c".repeat(64),
  consumerSecret: "d".repeat(64),
  tokenId: "e".repeat(64),
  tokenSecret: "f".repeat(64),
} as const;

const URL_ROOT = `${nsHost(DEMO_NS_CREDENTIALS.accountId)}/services/rest/query/v1/suiteql`;
export const isNetSuiteMockUrl = (url: string) => url.startsWith(`${nsHost(DEMO_NS_CREDENTIALS.accountId)}/`);

type Row = Record<string, unknown>;
const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body });
const nsError = (status: number, detail: string) => reply(status, { title: "Error", "o:errorDetails": [{ detail, "o:errorCode": status === 401 ? "INVALID_LOGIN" : "INVALID_PARAMETER" }] });

const head = (tranid: string, trandate: string, entityno: string, entityname: string, status: string) => ({ tranid, trandate, entityno, entityname, currency: DEMO_ACCOUNTING_CURRENCY, status });

/** Rows per transaction type, each with its trandate for the window filter. */
const TYPES: Record<string, Row[]> = {
  "CustInvc:head": DEMO_SALES_INVOICES.map((d) => {
    const total = docTotal(d.lines);
    const left = Math.round((total - d.paid) * 100) / 100;
    return { ...head(d.number, d.date, d.customerNo, d.customer, left === 0 ? "Paid In Full" : "Open"), otherrefnum: d.customerPo || null, duedate: d.due, foreigntotal: total, foreignamountremaining: left };
  }),
  "CustInvc:lines": DEMO_SALES_INVOICES.flatMap((d) => d.lines.map((l) => ({ ...head(d.number, d.date, d.customerNo, d.customer, "Open"), salesorder: d.salesOrder || null, sku: l.sku, memo: l.description, quantity: -l.qty, rate: l.price, foreignamount: -lineNet(l) }))),
  CustCred: DEMO_CREDIT_NOTES.map((d) => ({ ...head(d.number, d.date, d.customerNo, d.customer, "Open"), source: d.invoice, foreigntotal: -docTotal(d.lines), foreignamountremaining: -docTotal(d.lines) })),
  SalesOrd: DEMO_SALES_INVOICES.filter((d) => d.salesOrder).flatMap((d) => d.lines.map((l) => ({ ...head(d.salesOrder, d.date, d.customerNo, d.customer, "Billed"), otherrefnum: d.customerPo, sku: l.sku, memo: l.description, quantity: -l.qty, quantityshiprecv: -l.qty, quantitybilled: -l.qty, rate: l.price, foreignamount: -lineNet(l) }))),
  ItemShip: DEMO_SALES_INVOICES.filter((d) => d.salesOrder).flatMap((d) => d.lines.map((l) => ({ ...head(`IF-${d.salesOrder.slice(3)}`, d.date, d.customerNo, d.customer, "Shipped"), salesorder: d.salesOrder, sku: l.sku, memo: l.description, quantity: -l.qty }))),
  PurchOrd: DEMO_PURCHASE_ORDERS.flatMap((d) => d.lines.map((l) => ({ ...head(d.number, d.date, d.vendorNo, d.vendor, d.status), expected: d.expected, sku: l.sku, memo: l.description, quantity: l.qty, quantityshiprecv: l.received, quantitybilled: l.billed, rate: l.price, foreignamount: lineNet(l) }))),
  ItemRcpt: DEMO_RECEIPTS.flatMap((d) => d.lines.map((l) => ({ ...head(d.number, d.date, d.vendorNo, d.vendor, "Received"), po: d.po, sku: l.sku, memo: l.description, quantity: l.qty }))),
  VendBill: DEMO_BILLS.flatMap((d) => d.lines.map((l) => ({ ...head(d.number, d.date, d.vendorNo, d.vendor, "Open"), transactionnumber: d.posted, po: d.po, sku: l.sku, memo: l.description, quantity: l.qty, rate: l.price, foreignamount: lineNet(l) }))),
};
const ITEMS: Row[] = DEMO_ITEMS.filter((i) => i.tracked).map((i) => ({ sku: i.sku, displayname: i.name, itemtype: "InvtPart", totalquantityonhand: i.onHand }));

function rowsFor(q: string): Row[] {
  if (/COUNT\(\*\)/.test(q)) return [{ n: 3 }];
  if (/FROM item i/.test(q)) return ITEMS;
  const type = /t\.type = '(\w+)'/.exec(q)?.[1] ?? "";
  const key = type === "CustInvc" ? (/JOIN transactionline/.test(q) ? "CustInvc:lines" : "CustInvc:head") : type;
  const rows = TYPES[key];
  if (!rows) throw new Error(`The mock doesn't answer: ${q}`);
  const [from, to] = [...q.matchAll(/TO_DATE\('([\d-]+)'/g)].map((m) => m[1]);
  return rows.filter((r) => inWindow(String(r.trandate), from, to)).map((r) => ({ links: [], ...r }));
}

// The mock's own OAuth 1.0a check, written apart from the connector's signer.
const enc = (s: string) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
function validSignature(method: string, url: string, header: string): boolean {
  const fields = Object.fromEntries([...header.replace(/^OAuth /, "").matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], decodeURIComponent(m[2])]));
  if (fields.realm !== DEMO_NS_CREDENTIALS.accountId || fields.oauth_token !== DEMO_NS_CREDENTIALS.tokenId || fields.oauth_consumer_key !== DEMO_NS_CREDENTIALS.consumerKey) return false;
  if (fields.oauth_signature_method !== "HMAC-SHA256") return false;
  const u = new URL(url);
  const pairs: string[] = [];
  u.searchParams.forEach((v, k) => pairs.push(`${enc(k)}=${enc(v)}`));
  for (const [k, v] of Object.entries(fields)) if (k.startsWith("oauth_") && k !== "oauth_signature") pairs.push(`${enc(k)}=${enc(v)}`);
  pairs.sort();
  const base = `${method}&${enc(u.origin + u.pathname)}&${enc(pairs.join("&"))}`;
  const expected = createHmac("sha256", `${enc(DEMO_NS_CREDENTIALS.consumerSecret)}&${enc(DEMO_NS_CREDENTIALS.tokenSecret)}`).update(base).digest("base64");
  return expected === fields.oauth_signature;
}

export type MockNetSuiteOptions = { log?: { method: string; url: string; body?: string }[] };

export function mockNetSuite(options: MockNetSuiteOptions = {}): FetchLike {
  return async (url, init) => {
    options.log?.push({ method: init.method, url, body: init.body });
    if (!url.startsWith(`${URL_ROOT}?`) || init.method !== "POST") return nsError(404, "The demo account only answers SuiteQL.");
    if (!validSignature(init.method, url, init.headers.Authorization ?? "")) return nsError(401, "Invalid login attempt.");
    const { q } = JSON.parse(init.body ?? "{}") as { q?: string };
    const u = new URL(url);
    const limit = Number(u.searchParams.get("limit") ?? 1000);
    const offset = Number(u.searchParams.get("offset") ?? 0);
    const rows = rowsFor(q ?? "");
    const items = rows.slice(offset, offset + limit);
    return reply(200, { links: [], count: items.length, hasMore: offset + limit < rows.length, items, offset, totalResults: rows.length });
  };
}
