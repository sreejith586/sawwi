import type { FetchLike } from "../types";
import { XERO_API, XERO_CONNECTIONS_URL, XERO_TOKEN_URL } from "../xero";
import { DEMO_ACCOUNTING_COMPANY, DEMO_ACCOUNTING_CURRENCY, DEMO_BILLS, DEMO_CREDIT_NOTES, DEMO_ITEMS, DEMO_PURCHASE_ORDERS, DEMO_SALES_INVOICES, docNet, docTotal, docVat, inWindow, lineNet, lineVat, type DemoLine } from "./accounting-data";

// An in-process stand-in for one invented Xero organisation (D-85). It answers the token endpoint
// (code and refresh grants), /connections, and the Accounting API lists the connector reads,
// in Xero's JSON shapes with paging, so tests and the demo run the real connector offline.
// Only the demo organisation and the demo tokens are accepted.

export const DEMO_XERO_TENANT = "0e5a7c1d-5a3b-4d7e-9c2a-00000000e101";
const DEMO_ACCESS = "demo-only-xero-access-token";
export const DEMO_XERO_CREDENTIALS = {
  accessToken: DEMO_ACCESS,
  refreshToken: "demo-only-xero-refresh-token",
  expiresAt: String(Date.UTC(2100, 0, 1)),
  tenantId: DEMO_XERO_TENANT,
  tenantName: DEMO_ACCOUNTING_COMPANY,
};
/** The sign-in code the mock accepts, and the auth event its access token claims (D-83). */
export const DEMO_XERO_CODE = "demo-xero-code";
const AUTH_EVENT = "a1b2c3d4-0000-4000-8000-00000000e1e1";

export const isXeroMockUrl = (url: string) => url.startsWith("https://api.xero.com/") || url === XERO_TOKEN_URL;

type Doc = Record<string, unknown>;
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (n: string) => headers[n] ?? null }, json: async () => body });

const day = (iso: string) => ({ value: `/Date(${Date.parse(`${iso}T00:00:00Z`)}+0000)/`, string: `${iso}T00:00:00` });
const dated = (field: string, iso: string) => ({ [field]: day(iso).value, [`${field}String`]: day(iso).string });
const items = (lines: DemoLine[]) => lines.map((l) => ({ ItemCode: l.sku, Description: l.description, Quantity: l.qty, UnitAmount: l.price, LineAmount: lineNet(l), TaxAmount: lineVat(l), TaxType: "OUTPUT" }));
const totals = (lines: DemoLine[]) => ({ LineAmountTypes: "Exclusive", SubTotal: docNet(lines), TotalTax: docVat(lines), Total: docTotal(lines), CurrencyCode: DEMO_ACCOUNTING_CURRENCY });

const INVOICES: Doc[] = [
  ...DEMO_SALES_INVOICES.map((d) => {
    const total = docTotal(d.lines);
    const due = Math.round((total - d.paid) * 100) / 100;
    return { Type: "ACCREC", InvoiceID: `inv-${d.number}`, InvoiceNumber: d.number, Reference: d.customerPo, Contact: { ContactNumber: d.customerNo, Name: d.customer }, ...dated("Date", d.date), ...dated("DueDate", d.due), Status: due === 0 ? "PAID" : "AUTHORISED", AmountDue: due, AmountPaid: d.paid, ...totals(d.lines), LineItems: items(d.lines) };
  }),
  // A draft the connector must leave out.
  { Type: "ACCREC", InvoiceID: "inv-draft", InvoiceNumber: "INV-2099", Contact: { Name: "Draft Customer" }, ...dated("Date", "2026-10-30"), Status: "DRAFT", ...totals([]), LineItems: [] },
  ...DEMO_BILLS.map((d) => ({ Type: "ACCPAY", InvoiceID: `bill-${d.number}`, InvoiceNumber: d.number, Reference: d.po, Contact: { ContactNumber: d.vendorNo, Name: d.vendor }, ...dated("Date", d.date), Status: "AUTHORISED", AmountDue: docTotal(d.lines), ...totals(d.lines), LineItems: items(d.lines) })),
];
const CREDIT_NOTES: Doc[] = DEMO_CREDIT_NOTES.map((d) => ({ Type: "ACCRECCREDIT", CreditNoteNumber: d.number, Reference: d.invoice, Contact: { ContactNumber: d.customerNo, Name: d.customer }, ...dated("Date", d.date), Status: "AUTHORISED", RemainingCredit: docTotal(d.lines), ...totals(d.lines), LineItems: items(d.lines) }));
const PURCHASE_ORDERS: Doc[] = DEMO_PURCHASE_ORDERS.map((d) => ({ PurchaseOrderNumber: d.number, Contact: { ContactNumber: d.vendorNo, Name: d.vendor }, ...dated("Date", d.date), ...dated("DeliveryDate", d.expected), Status: d.status === "Fully Billed" ? "BILLED" : "AUTHORISED", ...totals(d.lines), LineItems: items(d.lines) }));
const ITEMS: Doc[] = DEMO_ITEMS.map((d) => ({ Code: d.sku, Name: d.name, IsTrackedAsInventory: d.tracked, ...(d.tracked ? { QuantityOnHand: d.onHand } : {}), SalesDetails: { UnitPrice: d.price } }));

/** Just enough of Xero's `where` syntax: Type=="X" and Date between DateTime(y, m, d) literals. */
function where(rows: Doc[], expr: string): Doc[] {
  const type = /Type=="(\w+)"/.exec(expr)?.[1];
  const dates = [...expr.matchAll(/DateTime\((\d+), (\d+), (\d+)\)/g)].map((m) => `${m[1]}-${m[2]}-${m[3]}`);
  return rows.filter((r) => (!type || r.Type === type) && (dates.length < 2 || inWindow(String(r.DateString).slice(0, 10), dates[0], dates[1])));
}

export type MockXeroOptions = { log?: { method: string; url: string }[]; pageSize?: number; refreshTokens?: string[]; connections?: Doc[] };

export function mockXero(options: MockXeroOptions = {}): FetchLike {
  const accessTokens = new Set([DEMO_ACCESS]);
  const refreshTokens = new Set(options.refreshTokens ?? [DEMO_XERO_CREDENTIALS.refreshToken]);
  let issued = 0;
  const issue = () => {
    issued++;
    // A JWT-shaped token carrying the auth event, as Xero's do.
    const access = `x.${Buffer.from(JSON.stringify({ authentication_event_id: AUTH_EVENT, n: issued })).toString("base64url")}.sig`;
    accessTokens.add(access);
    refreshTokens.add(`demo-xero-refresh-${issued}`);
    return reply(200, { access_token: access, refresh_token: `demo-xero-refresh-${issued}`, expires_in: 1800, token_type: "Bearer" });
  };
  return async (url, init) => {
    options.log?.push({ method: init.method, url });
    if (url === XERO_TOKEN_URL) {
      const form = new URLSearchParams(init.body ?? "");
      if (!init.headers.Authorization?.startsWith("Basic ")) return reply(400, { error: "invalid_client" });
      if (form.get("grant_type") === "authorization_code" && form.get("code") === DEMO_XERO_CODE) return issue();
      if (form.get("grant_type") === "refresh_token" && refreshTokens.delete(form.get("refresh_token") ?? "")) return issue();
      return reply(400, { error: "invalid_grant" });
    }
    if (init.method !== "GET") return reply(405, { Message: "The demo organisation is read-only." });
    if (!accessTokens.has((init.headers.Authorization ?? "").replace(/^Bearer /, ""))) return reply(401, { Title: "Unauthorized", Detail: "TokenExpired" });
    if (url === XERO_CONNECTIONS_URL) {
      return reply(200, options.connections ?? [{ id: "c-1", authEventId: AUTH_EVENT, tenantId: DEMO_XERO_TENANT, tenantType: "ORGANISATION", tenantName: DEMO_ACCOUNTING_COMPANY }]);
    }
    if (init.headers["xero-tenant-id"] !== DEMO_XERO_TENANT) return reply(403, { Title: "Forbidden", Detail: "AuthenticationUnsuccessful" });
    const u = new URL(url);
    const resource = u.pathname.slice(new URL(XERO_API).pathname.length + 1);
    const q = u.searchParams;
    let rows: Doc[];
    let key = resource;
    switch (resource) {
      case "Organisation":
        return reply(200, { Organisations: [{ Name: DEMO_ACCOUNTING_COMPANY, BaseCurrency: DEMO_ACCOUNTING_CURRENCY, CountryCode: "AE" }] });
      case "Items":
        return reply(200, { Items: ITEMS });
      case "Invoices":
        rows = where(INVOICES, q.get("where") ?? "");
        break;
      case "CreditNotes":
        rows = where(CREDIT_NOTES, q.get("where") ?? "");
        break;
      case "PurchaseOrders":
        rows = PURCHASE_ORDERS.filter((r) => inWindow(String(r.DateString).slice(0, 10), q.get("DateFrom") ?? "", q.get("DateTo") ?? "9999"));
        key = "PurchaseOrders";
        break;
      default:
        return reply(404, { Message: `The mock doesn't serve ${resource}` });
    }
    const statuses = q.get("Statuses")?.split(",");
    if (statuses) rows = rows.filter((r) => statuses.includes(String(r.Status)));
    const size = options.pageSize ?? Math.min(Number(q.get("pageSize") ?? 100), 1000);
    const page = Number(q.get("page") ?? 1);
    const pageCount = Math.max(1, Math.ceil(rows.length / size));
    return reply(200, { pagination: { page, pageSize: size, pageCount, itemCount: rows.length }, [key]: rows.slice((page - 1) * size, page * size) });
  };
}
