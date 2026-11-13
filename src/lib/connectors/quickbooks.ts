import { num, str } from "./format";
import { accessTokenFor, appFromEnv, parseTokens, tokenRequest, type OAuthTokens } from "./oauth";
import { ConnectorError, type Connector, type ConnectorDeps, type PullWindow } from "./types";

// QuickBooks Online, Accounting API v3 (D-82). Read-only.
//
// Auth: OAuth 2.0 authorization code (D-81). The user clicks "Connect with QuickBooks", signs in
// at Intuit and picks a company; Intuit sends back a code and the company's realm ID. Sawwi's
// app keys come from SAWWI_QUICKBOOKS_CLIENT_ID / _SECRET; SAWWI_QUICKBOOKS_ENVIRONMENT=sandbox
// points new connections at Intuit's sandbox companies. The only scope is
// com.intuit.quickbooks.accounting, and Sawwi only sends GET requests with it.
//
// Hosts are fixed (Intuit's sign-in, token and API hosts) and the realm ID is digits only, so a
// connection can't point the server anywhere else. Lists are read with the query language,
// 1,000 rows a page (Intuit's maximum).
//
// Docs: https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0
//       https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries

export const QBO_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
export const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const QBO_API_HOSTS = { production: "https://quickbooks.api.intuit.com", sandbox: "https://sandbox-quickbooks.api.intuit.com" } as const;
export const QBO_SCOPE = "com.intuit.quickbooks.accounting";
const MINOR_VERSION = "75";
const PAGE = 1000;
const MAX_ATTEMPTS = 5;
const MAX_ROWS = 200_000;

export type QuickBooksCredentials = OAuthTokens & { realmId: string; environment: "production" | "sandbox" };

type Doc = Record<string, unknown>;
const ref = (v: unknown) => (v ?? {}) as { value?: string; name?: string };

const qboApp = () => appFromEnv("SAWWI_QUICKBOOKS_CLIENT_ID", "SAWWI_QUICKBOOKS_CLIENT_SECRET");
const qboEnvironment = (): QuickBooksCredentials["environment"] => (process.env.SAWWI_QUICKBOOKS_ENVIRONMENT === "sandbox" ? "sandbox" : "production");

export function normaliseRealm(input: string): string {
  const r = (input ?? "").trim();
  if (!/^\d{1,20}$/.test(r)) throw new ConnectorError("QuickBooks didn't send a valid company (realm) ID. Try connecting again.");
  return r;
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

type Session = { creds: QuickBooksCredentials; deps: ConnectorDeps; token: string; root: string };

async function openSession(creds: QuickBooksCredentials, deps: ConnectorDeps): Promise<Session> {
  const token = await accessTokenFor(creds, qboApp(), QBO_TOKEN_URL, deps, "QuickBooks");
  return { creds, deps, token, root: `${QBO_API_HOSTS[creds.environment]}/v3/company/${creds.realmId}` };
}

type Fault = { Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[] } };

async function getJson(s: Session, path: string): Promise<Doc> {
  const url = `${s.root}${path}${path.includes("?") ? "&" : "?"}minorversion=${MINOR_VERSION}`;
  for (let attempt = 1; ; attempt++) {
    const res = await s.deps.fetch(url, { method: "GET", headers: { Authorization: `Bearer ${s.token}`, Accept: "application/json" } });
    if (res.status === 401) throw new ConnectorError("QuickBooks rejected the sign-in. Remove this connection and connect again.");
    if (res.status === 403) throw new ConnectorError("The QuickBooks user who connected can't read this data. Connect again as a company admin, or check the company's subscription.");
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= MAX_ATTEMPTS) throw new ConnectorError(`QuickBooks is busy (HTTP ${res.status}). Try again in a minute.`);
      const after = Number(res.headers.get("Retry-After"));
      await s.deps.sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * attempt);
      continue;
    }
    const json = (await res.json().catch(() => ({}))) as Doc & Fault;
    const err = json.Fault?.Error?.[0];
    if (!res.ok || err) throw new ConnectorError(`QuickBooks: ${err?.Detail || err?.Message || `HTTP ${res.status}`}`);
    return json;
  }
}

/** Every row of a query, paged 1,000 at a time. `sql` has no STARTPOSITION/MAXRESULTS. */
export async function queryAll(s: Session, entity: string, sql: string): Promise<Doc[]> {
  const out: Doc[] = [];
  for (let start = 1; ; start += PAGE) {
    const page = await getJson(s, `/query?query=${encodeURIComponent(`${sql} STARTPOSITION ${start} MAXRESULTS ${PAGE}`)}`);
    const rows = ((page.QueryResponse as Doc | undefined)?.[entity] as Doc[] | undefined) ?? [];
    out.push(...rows);
    if (out.length > MAX_ROWS) throw new ConnectorError("More than 200,000 rows in that period. Pull a shorter period.");
    if (rows.length < PAGE) return out;
  }
}

/** A QuickBooks query string literal: backslash-escaped single quotes. */
export const qboString = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

async function homeCurrency(s: Session): Promise<string> {
  const prefs = await queryAll(s, "Preferences", "SELECT * FROM Preferences");
  const currencyPrefs = prefs[0]?.CurrencyPrefs as Doc | undefined;
  return str(ref(currencyPrefs?.HomeCurrency).value);
}

// ─── Reports ──────────────────────────────────────────────────────────────────

type Ctx = { lcy: string; poNumbers: Map<string, string> };

const currency = (d: Doc, lcy: string) => ref(d.CurrencyRef).value || lcy;
const tax = (d: Doc) => Number((d.TxnTaxDetail as Doc | undefined)?.TotalTax ?? 0);
/** Lines that sell or buy something; subtotal, discount and description-only lines are left out. */
const detailLines = (d: Doc, detail: string[]) => ((d.Line as Doc[] | undefined) ?? []).filter((l) => detail.includes(str(l.DetailType)));
const lineDetail = (l: Doc) => (l[str(l.DetailType)] ?? {}) as Doc;

export function invoiceStatus(total: number, balance: number): string {
  if (Math.abs(balance) < 0.005) return "Paid";
  return Math.abs(balance - total) < 0.005 ? "Open" : "Partially paid";
}

type ReportSpec = {
  id: string;
  label: string;
  description: string;
  slots: string[];
  entity: string;
  dated: boolean;
  needsPoNumbers?: boolean;
  columns: readonly string[];
  rows: (d: Doc, ctx: Ctx) => string[][];
};

export const QBO_REPORTS: ReportSpec[] = [
  {
    id: "sales_invoices",
    label: "Invoices",
    description: "Invoices dated in the period, with VAT, open balance and status.",
    slots: ["b2b-cash-application/invoices", "b2b_invoices", "sales"],
    entity: "Invoice",
    dated: true,
    columns: ["Invoice number", "Customer no.", "Customer", "Invoice date", "Due date", "Currency", "Amount excl. VAT", "VAT amount", "Invoice amount (incl. VAT)", "Open amount", "Status"],
    rows: (d, { lcy }) => {
      const total = Number(d.TotalAmt ?? 0);
      return [[str(d.DocNumber || d.Id), str(ref(d.CustomerRef).value), str(ref(d.CustomerRef).name), str(d.TxnDate), str(d.DueDate), currency(d, lcy), num(total - tax(d)), num(tax(d)), num(total), num(d.Balance ?? 0), invoiceStatus(total, Number(d.Balance ?? 0))]];
    },
  },
  {
    id: "sales_invoice_lines",
    label: "Invoice lines",
    description: "Invoice lines dated in the period, with product, quantity and price.",
    slots: ["invoice_lines"],
    entity: "Invoice",
    dated: true,
    columns: ["Invoice number", "Invoice date", "Customer no.", "Customer", "SKU", "Description", "Quantity", "Unit price", "Line amount", "Currency"],
    rows: (d, { lcy }) =>
      detailLines(d, ["SalesItemLineDetail"]).map((l) => {
        const x = lineDetail(l);
        return [str(d.DocNumber || d.Id), str(d.TxnDate), str(ref(d.CustomerRef).value), str(ref(d.CustomerRef).name), str(ref(x.ItemRef).name), str(l.Description), num(x.Qty ?? 0), num(x.UnitPrice ?? 0), num(l.Amount ?? 0), currency(d, lcy)];
      }),
  },
  {
    id: "sales_credit_memos",
    label: "Credit memos",
    description: "Credit memos dated in the period, with VAT and the credit still unused.",
    slots: ["credit_notes"],
    entity: "CreditMemo",
    dated: true,
    columns: ["Credit note no.", "Credit note date", "Customer no.", "Customer", "Currency", "Amount excl. VAT", "VAT amount", "Credit amount", "Unused credit"],
    rows: (d, { lcy }) => {
      const total = Number(d.TotalAmt ?? 0);
      return [[str(d.DocNumber || d.Id), str(d.TxnDate), str(ref(d.CustomerRef).value), str(ref(d.CustomerRef).name), currency(d, lcy), num(total - tax(d)), num(tax(d)), num(total), num(d.Balance ?? d.RemainingCredit ?? 0)]];
    },
  },
  {
    id: "purchase_order_lines",
    label: "Purchase order lines",
    description: "Purchase order lines dated in the period, with quantity, price and whether the order is still open.",
    slots: ["po"],
    entity: "PurchaseOrder",
    dated: true,
    columns: ["PO number", "PO date", "Vendor no.", "Supplier", "Expected delivery date", "SKU", "Description", "Qty ordered", "PO unit price (excl. VAT)", "Line amount (excl. VAT)", "Currency", "Status"],
    rows: (d, { lcy }) =>
      detailLines(d, ["ItemBasedExpenseLineDetail"]).map((l) => {
        const x = lineDetail(l);
        return [str(d.DocNumber || d.Id), str(d.TxnDate), str(ref(d.VendorRef).value), str(ref(d.VendorRef).name), str(d.DueDate), str(ref(x.ItemRef).name), str(l.Description), num(x.Qty ?? 0), num(x.UnitPrice ?? 0), num(l.Amount ?? 0), currency(d, lcy), str(d.POStatus)];
      }),
  },
  {
    id: "purchase_invoice_lines",
    label: "Bill lines",
    description: "Bills dated in the period, line by line, with the supplier's bill number and the purchase order they came from.",
    slots: ["p2p-three-way-match/invoices"],
    entity: "Bill",
    dated: true,
    needsPoNumbers: true,
    columns: ["Supplier invoice no.", "Invoice date", "PO number", "Vendor no.", "Supplier", "SKU", "Description", "Qty invoiced", "Unit cost", "Line amount (excl. VAT)", "Currency"],
    rows: (d, { lcy, poNumbers }) => {
      const po = poIdsOf(d).map((id) => poNumbers.get(id) ?? "").filter(Boolean).join(", ");
      return detailLines(d, ["ItemBasedExpenseLineDetail", "AccountBasedExpenseLineDetail"]).map((l) => {
        const x = lineDetail(l);
        const item = str(ref(x.ItemRef).name) || str(ref(x.AccountRef).name);
        return [str(d.DocNumber || d.Id), str(d.TxnDate), po, str(ref(d.VendorRef).value), str(ref(d.VendorRef).name), item, str(l.Description), num(x.Qty ?? 1), num(x.UnitPrice ?? l.Amount ?? 0), num(l.Amount ?? 0), currency(d, lcy)];
      });
    },
  },
  {
    id: "items",
    label: "Products and services (quantity on hand and price)",
    description: "Every active product and service with quantity on hand and sales price. Not dated: it's the list right now.",
    slots: ["web-erp-stock/erp_stock", "web-erp-prices/erp_prices"],
    entity: "Item",
    dated: false,
    columns: ["SKU", "Description", "Type", "Inventory", "Unit price"],
    rows: (d) => [[str(d.Sku || d.Name), str(d.Description || d.Name), str(d.Type), num(d.QtyOnHand ?? 0), num(d.UnitPrice ?? 0)]],
  },
];

/** Purchase orders a bill was made from (LinkedTxn on the bill or its lines). */
function poIdsOf(d: Doc): string[] {
  const links = [...((d.LinkedTxn as Doc[] | undefined) ?? []), ...((d.Line as Doc[] | undefined) ?? []).flatMap((l) => (l.LinkedTxn as Doc[] | undefined) ?? [])];
  return [...new Set(links.filter((t) => t.TxnType === "PurchaseOrder").map((t) => str(t.TxnId)))];
}

export function reportQuery(spec: Pick<ReportSpec, "entity" | "dated">, w: PullWindow): string {
  if (!spec.dated) return `SELECT * FROM ${spec.entity} WHERE Active = true`;
  return `SELECT * FROM ${spec.entity} WHERE TxnDate >= ${qboString(w.from)} AND TxnDate <= ${qboString(w.to)} ORDERBY TxnDate`;
}

async function poNumbersFor(s: Session, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    for (const po of await queryAll(s, "PurchaseOrder", `SELECT Id, DocNumber FROM PurchaseOrder WHERE Id IN (${chunk.map(qboString).join(", ")})`)) out.set(str(po.Id), str(po.DocNumber || po.Id));
  }
  return out;
}

// ─── Connector ────────────────────────────────────────────────────────────────

export const quickbooks: Connector<QuickBooksCredentials> = {
  id: "quickbooks",
  label: "QuickBooks Online",
  description: "QuickBooks Online: invoices, credit memos, bills, purchase orders and products for the B2B and purchasing reconciliations. Read-only.",
  fields: [],
  reports: QBO_REPORTS.map(({ id, label, description, slots }) => ({ id, label, description, slots })),

  oauth: {
    app: qboApp,
    envVars: ["SAWWI_QUICKBOOKS_CLIENT_ID", "SAWWI_QUICKBOOKS_CLIENT_SECRET"],
    authorizeUrl(app, redirectUri, state) {
      const q = new URLSearchParams({ client_id: app.clientId, response_type: "code", scope: QBO_SCOPE, redirect_uri: redirectUri, state });
      return `${QBO_AUTHORIZE_URL}?${q}`;
    },
    async complete(app, query, redirectUri, deps) {
      const code = query.get("code") ?? "";
      if (!code) throw new ConnectorError("QuickBooks didn't send a sign-in code. Try connecting again.");
      const realmId = normaliseRealm(query.get("realmId") ?? "");
      const tokens = await tokenRequest(QBO_TOKEN_URL, app, { grant_type: "authorization_code", code, redirect_uri: redirectUri }, deps, "QuickBooks");
      return { ...tokens, realmId, environment: qboEnvironment() };
    },
  },

  parseCredentials(input) {
    return { ...parseTokens(input, "QuickBooks"), realmId: normaliseRealm(input.realmId ?? ""), environment: input.environment === "sandbox" ? "sandbox" : "production" };
  },

  async test(creds, deps) {
    const s = await openSession(creds, deps);
    const info = (await getJson(s, `/companyinfo/${creds.realmId}`)).CompanyInfo as Doc | undefined;
    const name = str(info?.CompanyName) || `Company ${creds.realmId}`;
    return { accountLabel: creds.environment === "sandbox" ? `${name} (Sandbox)` : name };
  },

  async pull(creds, report, window, deps) {
    const spec = QBO_REPORTS.find((r) => r.id === report);
    if (!spec) throw new ConnectorError(`Unknown QuickBooks report: ${report}`);
    const s = await openSession(creds, deps);
    const docs = await queryAll(s, spec.entity, reportQuery(spec, window));
    const ctx: Ctx = { lcy: await homeCurrency(s), poNumbers: new Map() };
    if (spec.needsPoNumbers) ctx.poNumbers = await poNumbersFor(s, [...new Set(docs.flatMap(poIdsOf))]);
    return { headers: [...spec.columns], rows: docs.flatMap((d) => spec.rows(d, ctx)) };
  },
};
