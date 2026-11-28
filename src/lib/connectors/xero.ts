import { num, str } from "./format";
import { accessTokenFor, appFromEnv, jwtClaims, parseTokens, tokenRequest, type OAuthTokens } from "./oauth";
import { ConnectorError, type Connector, type ConnectorDeps, type PullWindow } from "./types";

// Xero Accounting API 2.0 (D-83). Read-only.
//
// Auth: OAuth 2.0 authorization code (D-81). The user clicks "Connect with Xero", signs in and
// picks one organisation. Sawwi's app keys come from SAWWI_XERO_CLIENT_ID / _SECRET. Scopes are
// read-only (granular, as Xero requires of new apps from 2026); SAWWI_XERO_SCOPES overrides them.
// One connection is one organisation: a Xero sign-in's refresh token is shared by every
// organisation picked in it, and it rotates on each use, so two connections can't share it.
//
// Hosts are fixed (login.xero.com, identity.xero.com, api.xero.com) and the organisation is a
// GUID sent in the xero-tenant-id header. Lists are paged; Xero allows 60 calls a minute per
// organisation and answers 429 with Retry-After past that.
//
// Docs: https://developer.xero.com/documentation/guides/oauth2/auth-flow
//       https://developer.xero.com/documentation/api/accounting/invoices

export const XERO_AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
export const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
export const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";
export const XERO_API = "https://api.xero.com/api.xro/2.0";
export const XERO_DEFAULT_SCOPES = "offline_access accounting.invoices.read accounting.settings.read accounting.contacts.read";
const PAGE_SIZE = 1000;
const MAX_ATTEMPTS = 5;
const MAX_ROWS = 200_000;

export type XeroCredentials = OAuthTokens & { tenantId: string; tenantName: string };

type Doc = Record<string, unknown>;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const xeroApp = () => appFromEnv("SAWWI_XERO_CLIENT_ID", "SAWWI_XERO_CLIENT_SECRET");
const xeroScopes = () => (process.env.SAWWI_XERO_SCOPES ?? "").trim() || XERO_DEFAULT_SCOPES;

// ─── HTTP ─────────────────────────────────────────────────────────────────────

type Session = { creds: XeroCredentials; deps: ConnectorDeps; token: string };

async function openSession(creds: XeroCredentials, deps: ConnectorDeps): Promise<Session> {
  return { creds, deps, token: await accessTokenFor(creds, xeroApp(), XERO_TOKEN_URL, deps, "Xero") };
}

type XeroError = { Message?: string; Detail?: string; Elements?: { ValidationErrors?: { Message?: string }[] }[] };

async function getJson(deps: ConnectorDeps, token: string, url: string, tenantId?: string): Promise<Doc> {
  if (!url.startsWith("https://api.xero.com/")) throw new ConnectorError("Refused to call outside Xero's API host.");
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  if (tenantId) headers["xero-tenant-id"] = tenantId;
  for (let attempt = 1; ; attempt++) {
    const res = await deps.fetch(url, { method: "GET", headers });
    if (res.status === 401) throw new ConnectorError("Xero rejected the sign-in. Remove this connection and connect again.");
    if (res.status === 403) throw new ConnectorError("Xero didn't allow this. The organisation may have been disconnected from Sawwi in Xero; connect it again.");
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= MAX_ATTEMPTS) throw new ConnectorError(`Xero is busy (HTTP ${res.status}). Try again in a minute.`);
      const after = Number(res.headers.get("Retry-After"));
      await deps.sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 60) * 1000 : 1000 * attempt);
      continue;
    }
    const json = (await res.json().catch(() => ({}))) as Doc & XeroError;
    if (!res.ok) throw new ConnectorError(`Xero: ${json.Elements?.[0]?.ValidationErrors?.[0]?.Message || json.Detail || json.Message || `HTTP ${res.status}`}`);
    return json;
  }
}

/** Every row of a paged list: pages until Xero says it was the last, or a page comes back empty. */
async function listAll(s: Session, path: string, key: string, params: Record<string, string>): Promise<Doc[]> {
  const out: Doc[] = [];
  for (let page = 1; ; page++) {
    const q = new URLSearchParams({ ...params, page: String(page), pageSize: String(PAGE_SIZE) });
    const json = await getJson(s.deps, s.token, `${XERO_API}/${path}?${q}`, s.creds.tenantId);
    const rows = (json[key] as Doc[] | undefined) ?? [];
    out.push(...rows);
    if (out.length > MAX_ROWS) throw new ConnectorError("More than 200,000 rows in that period. Pull a shorter period.");
    const pageCount = Number((json.pagination as Doc | undefined)?.pageCount);
    if (rows.length === 0 || (Number.isFinite(pageCount) && page >= pageCount)) return out;
  }
}

/** Xero's `where` date literal for an ISO day. */
export const xeroDate = (iso: string) => `DateTime(${iso.slice(0, 4)}, ${iso.slice(5, 7)}, ${iso.slice(8, 10)})`;
export const xeroWhere = (type: string, w: PullWindow) => `Type=="${type}" AND Date>=${xeroDate(w.from)} AND Date<=${xeroDate(w.to)}`;

/** Xero dates come as "2026-10-03T00:00:00" in *DateString, or as "/Date(1759449600000+0000)/". */
export function xeroDay(d: Doc, field: string): string {
  const s = str(d[`${field}String`]);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const ms = /\/Date\((-?\d+)/.exec(str(d[field]))?.[1];
  return ms ? new Date(Number(ms)).toISOString().slice(0, 10) : "";
}

// ─── Reports ──────────────────────────────────────────────────────────────────

const contact = (d: Doc) => (d.Contact ?? {}) as { ContactNumber?: string; Name?: string };
const lineItems = (d: Doc) => ((d.LineItems as Doc[] | undefined) ?? []).filter((l) => l.Quantity !== undefined || l.LineAmount !== undefined);
/** Line amount excluding VAT, whatever the document's LineAmountTypes. */
export function lineNet(d: Doc, l: Doc): number {
  const amount = Number(l.LineAmount ?? 0);
  return d.LineAmountTypes === "Inclusive" ? amount - Number(l.TaxAmount ?? 0) : amount;
}

type ReportSpec = {
  id: string;
  label: string;
  description: string;
  slots: string[];
  fetch: (s: Session, w: PullWindow) => Promise<Doc[]>;
  columns: readonly string[];
  rows: (d: Doc, lcy: string) => string[][];
};

const POSTED = "AUTHORISED,PAID";
const invoices = (type: string) => (s: Session, w: PullWindow) => listAll(s, "Invoices", "Invoices", { where: xeroWhere(type, w), Statuses: POSTED });
const cur = (d: Doc, lcy: string) => str(d.CurrencyCode) || lcy;

export const XERO_REPORTS: ReportSpec[] = [
  {
    id: "sales_invoices",
    label: "Sales invoices",
    description: "Approved and paid sales invoices dated in the period, with VAT, amount due and status.",
    slots: ["b2b-cash-application/invoices", "b2b_invoices", "sales"],
    fetch: invoices("ACCREC"),
    columns: ["Invoice number", "Reference", "Customer no.", "Customer", "Invoice date", "Due date", "Currency", "Amount excl. VAT", "VAT amount", "Invoice amount (incl. VAT)", "Open amount", "Status"],
    rows: (d, lcy) => [[str(d.InvoiceNumber), str(d.Reference), str(contact(d).ContactNumber), str(contact(d).Name), xeroDay(d, "Date"), xeroDay(d, "DueDate"), cur(d, lcy), num(d.SubTotal ?? 0), num(d.TotalTax ?? 0), num(d.Total ?? 0), num(d.AmountDue ?? 0), str(d.Status)]],
  },
  {
    id: "sales_invoice_lines",
    label: "Sales invoice lines",
    description: "Lines of approved and paid sales invoices dated in the period, with item, quantity, price and VAT.",
    slots: ["invoice_lines"],
    fetch: invoices("ACCREC"),
    columns: ["Invoice number", "Invoice date", "Customer no.", "Customer", "SKU", "Description", "Quantity", "Unit price", "Discount %", "Line amount", "VAT amount", "Currency"],
    rows: (d, lcy) =>
      lineItems(d).map((l) => [str(d.InvoiceNumber), xeroDay(d, "Date"), str(contact(d).ContactNumber), str(contact(d).Name), str(l.ItemCode), str(l.Description), num(l.Quantity ?? 0), num(l.UnitAmount ?? 0), num(l.DiscountRate ?? 0), num(lineNet(d, l)), num(l.TaxAmount ?? 0), cur(d, lcy)]),
  },
  {
    id: "sales_credit_memos",
    label: "Sales credit notes",
    description: "Approved and paid sales credit notes dated in the period, with VAT and the credit still unused.",
    slots: ["credit_notes"],
    fetch: (s, w) => listAll(s, "CreditNotes", "CreditNotes", { where: xeroWhere("ACCRECCREDIT", w), Statuses: POSTED }),
    columns: ["Credit note no.", "Credit note date", "Reference", "Customer no.", "Customer", "Currency", "Amount excl. VAT", "VAT amount", "Credit amount", "Unused credit", "Status"],
    rows: (d, lcy) => [[str(d.CreditNoteNumber), xeroDay(d, "Date"), str(d.Reference), str(contact(d).ContactNumber), str(contact(d).Name), cur(d, lcy), num(d.SubTotal ?? 0), num(d.TotalTax ?? 0), num(d.Total ?? 0), num(d.RemainingCredit ?? 0), str(d.Status)]],
  },
  {
    id: "purchase_order_lines",
    label: "Purchase order lines",
    description: "Lines of purchase orders dated in the period (drafts and deleted ones left out), with delivery date and status.",
    slots: ["po"],
    fetch: async (s, w) => (await listAll(s, "PurchaseOrders", "PurchaseOrders", { DateFrom: w.from, DateTo: w.to })).filter((d) => !["DRAFT", "DELETED"].includes(str(d.Status))),
    columns: ["PO number", "PO date", "Vendor no.", "Supplier", "Expected delivery date", "SKU", "Description", "Qty ordered", "PO unit price (excl. VAT)", "Line amount (excl. VAT)", "Currency", "Status"],
    rows: (d, lcy) =>
      lineItems(d).map((l) => [str(d.PurchaseOrderNumber), xeroDay(d, "Date"), str(contact(d).ContactNumber), str(contact(d).Name), xeroDay(d, "DeliveryDate"), str(l.ItemCode), str(l.Description), num(l.Quantity ?? 0), num(l.UnitAmount ?? 0), num(lineNet(d, l)), cur(d, lcy), str(d.Status)]),
  },
  {
    id: "purchase_invoice_lines",
    label: "Bill lines",
    description: "Lines of approved and paid bills dated in the period, with the supplier's invoice number and reference.",
    slots: ["p2p-three-way-match/invoices"],
    fetch: invoices("ACCPAY"),
    columns: ["Supplier invoice no.", "Invoice date", "Reference", "Vendor no.", "Supplier", "SKU", "Description", "Qty invoiced", "Unit cost", "Line amount (excl. VAT)", "VAT amount", "Currency"],
    rows: (d, lcy) =>
      lineItems(d).map((l) => [str(d.InvoiceNumber), xeroDay(d, "Date"), str(d.Reference), str(contact(d).ContactNumber), str(contact(d).Name), str(l.ItemCode), str(l.Description), num(l.Quantity ?? 0), num(l.UnitAmount ?? 0), num(lineNet(d, l)), num(l.TaxAmount ?? 0), cur(d, lcy)]),
  },
  {
    id: "items",
    label: "Items (quantity on hand and price)",
    description: "Every item with quantity on hand (tracked items) and sales price. Not dated: it's the list right now.",
    slots: ["web-erp-stock/erp_stock", "web-erp-prices/erp_prices"],
    fetch: async (s) => (await getJson(s.deps, s.token, `${XERO_API}/Items`, s.creds.tenantId)).Items as Doc[] ?? [],
    columns: ["SKU", "Description", "Tracked", "Inventory", "Unit price"],
    rows: (d) => [[str(d.Code), str(d.Name || d.Description), d.IsTrackedAsInventory ? "Yes" : "No", num(d.QuantityOnHand ?? 0), num((d.SalesDetails as Doc | undefined)?.UnitPrice ?? 0)]],
  },
];

async function organisation(s: Session): Promise<{ name: string; currency: string }> {
  const org = ((await getJson(s.deps, s.token, `${XERO_API}/Organisation`, s.creds.tenantId)).Organisations as Doc[] | undefined)?.[0] ?? {};
  return { name: str(org.Name), currency: str(org.BaseCurrency) };
}

// ─── Connector ────────────────────────────────────────────────────────────────

type XeroConnection = { tenantId?: string; tenantType?: string; tenantName?: string; authEventId?: string };

/** The one organisation this sign-in connected (D-83). */
export function pickTenant(connections: XeroConnection[], authEventId: string): { tenantId: string; tenantName: string } {
  const orgs = connections.filter((c) => c.tenantType === "ORGANISATION" && GUID.test(c.tenantId ?? ""));
  const fromThisSignIn = authEventId ? orgs.filter((c) => c.authEventId === authEventId) : orgs;
  if (fromThisSignIn.length === 0) throw new ConnectorError("No Xero organisation was connected. Try again and pick an organisation.");
  if (fromThisSignIn.length > 1) throw new ConnectorError("Pick one organisation when Xero asks. Connect each organisation separately.");
  return { tenantId: fromThisSignIn[0].tenantId!.toLowerCase(), tenantName: str(fromThisSignIn[0].tenantName) };
}

export const xero: Connector<XeroCredentials> = {
  id: "xero",
  label: "Xero",
  description: "Xero: sales invoices, credit notes, bills, purchase orders and items for the B2B and purchasing reconciliations. Read-only.",
  fields: [],
  reports: XERO_REPORTS.map(({ id, label, description, slots }) => ({ id, label, description, slots })),

  oauth: {
    app: xeroApp,
    envVars: ["SAWWI_XERO_CLIENT_ID", "SAWWI_XERO_CLIENT_SECRET"],
    authorizeUrl(app, redirectUri, state) {
      const q = new URLSearchParams({ response_type: "code", client_id: app.clientId, redirect_uri: redirectUri, scope: xeroScopes(), state });
      return `${XERO_AUTHORIZE_URL}?${q}`;
    },
    async complete(app, query, redirectUri, deps) {
      const code = query.get("code") ?? "";
      if (!code) throw new ConnectorError("Xero didn't send a sign-in code. Try connecting again.");
      const tokens = await tokenRequest(XERO_TOKEN_URL, app, { grant_type: "authorization_code", code, redirect_uri: redirectUri }, deps, "Xero");
      const connections = (await getJson(deps, tokens.accessToken, XERO_CONNECTIONS_URL)) as unknown as XeroConnection[];
      const tenant = pickTenant(Array.isArray(connections) ? connections : [], str(jwtClaims(tokens.accessToken).authentication_event_id));
      return { ...tokens, ...tenant };
    },
  },

  parseCredentials(input) {
    const tenantId = (input.tenantId ?? "").trim().toLowerCase();
    if (!GUID.test(tenantId)) throw new ConnectorError("Connect Xero with the “Connect with Xero” button.");
    return { ...parseTokens(input, "Xero"), tenantId, tenantName: (input.tenantName ?? "").slice(0, 200) };
  },

  async test(creds, deps) {
    const s = await openSession(creds, deps);
    const org = await organisation(s);
    return { accountLabel: org.name || creds.tenantName || "Xero organisation" };
  },

  async pull(creds, report, window, deps) {
    const spec = XERO_REPORTS.find((r) => r.id === report);
    if (!spec) throw new ConnectorError(`Unknown Xero report: ${report}`);
    const s = await openSession(creds, deps);
    const { currency } = await organisation(s);
    const docs = await spec.fetch(s, window);
    return { headers: [...spec.columns], rows: docs.flatMap((d) => spec.rows(d, currency)) };
  },
};
