import { createHmac, randomBytes } from "node:crypto";
import { num, str } from "./format";
import { ConnectorError, type Connector, type ConnectorDeps, type PullWindow } from "./types";

// Oracle NetSuite, SuiteQL over the REST web services (D-84). Read-only.
//
// Auth: token-based authentication (OAuth 1.0a, HMAC-SHA256), which suits one company connecting
// its own account: the admin creates an integration record (consumer key and secret) and an
// access token for a role (token ID and secret), and pastes the four values plus the account ID.
// The role needs "Log in using Access Tokens", "REST Web Services" and "SuiteAnalytics Workbook"
// plus view access to the records read (transactions, items). Nothing is ever written: SuiteQL is
// a POST, but only a query.
//
// The host is built from the account ID only (digits, optionally _SB1 / _RP for sandbox and
// release preview), always on suitetalk.api.netsuite.com, so a connection can't point the server
// anywhere else. Dates are formatted in SQL so the user's date preference doesn't matter.
//
// Docs: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157771281570.html (SuiteQL)
//       https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4247337262.html (TBA)

export const NS_HOST_SUFFIX = ".suitetalk.api.netsuite.com";
const PAGE = 1000;
const MAX_ATTEMPTS = 5;
const MAX_ROWS = 100_000; // SuiteQL's own limit on offset paging

export type NetSuiteCredentials = { accountId: string; consumerKey: string; consumerSecret: string; tokenId: string; tokenSecret: string };

type Doc = Record<string, unknown>;

/** "1234567", "1234567_SB1" or "1234567-sb1" → "1234567_SB1" (the OAuth realm). */
export function normaliseAccount(input: string): string {
  const a = (input ?? "").trim().toUpperCase().replace(/-/g, "_");
  if (!/^[0-9]{3,12}(_(SB|RP)[0-9]{0,3})?$/.test(a)) throw new ConnectorError("Enter the NetSuite account ID, e.g. 1234567 or 1234567_SB1 (Setup → Company → Company Information).");
  return a;
}

/** The REST host for an account: "1234567_SB1" → https://1234567-sb1.suitetalk.api.netsuite.com */
export const nsHost = (accountId: string) => `https://${accountId.toLowerCase().replace(/_/g, "-")}${NS_HOST_SUFFIX}`;

// ─── OAuth 1.0a signing ───────────────────────────────────────────────────────

/** RFC 3986 percent-encoding, as OAuth 1.0a requires (encodeURIComponent leaves !'()* alone). */
export const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** The Authorization header for one request. Query parameters are part of the signature. */
export function oauthHeader(creds: NetSuiteCredentials, method: string, url: string, nonce = randomBytes(16).toString("hex"), timestamp = String(Math.floor(Date.now() / 1000))): string {
  const u = new URL(url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: timestamp,
    oauth_token: creds.tokenId,
    oauth_version: "1.0",
  };
  const params = [...[...u.searchParams.entries()], ...Object.entries(oauth)].map(([k, v]) => [pct(k), pct(v)]).sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1));
  const base = [method.toUpperCase(), pct(`${u.origin}${u.pathname}`), pct(params.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
  const signature = createHmac("sha256", `${pct(creds.consumerSecret)}&${pct(creds.tokenSecret)}`).update(base).digest("base64");
  const fields = { realm: creds.accountId, ...oauth, oauth_signature: signature };
  return `OAuth ${Object.entries(fields).map(([k, v]) => `${k}="${pct(v)}"`).join(", ")}`;
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

type NsError = { "o:errorDetails"?: { detail?: string; "o:errorCode"?: string }[]; title?: string };

async function suiteqlPage(creds: NetSuiteCredentials, deps: ConnectorDeps, sql: string, offset: number): Promise<{ items: Doc[]; hasMore: boolean }> {
  const url = `${nsHost(creds.accountId)}/services/rest/query/v1/suiteql?limit=${PAGE}&offset=${offset}`;
  for (let attempt = 1; ; attempt++) {
    const res = await deps.fetch(url, {
      method: "POST",
      headers: { Authorization: oauthHeader(creds, "POST", url), "Content-Type": "application/json", Accept: "application/json", Prefer: "transient" },
      body: JSON.stringify({ q: sql }),
    });
    if (res.status === 401) {
      throw new ConnectorError(
        "NetSuite rejected the token. Check the account ID, consumer key and secret, token ID and secret, and that the token's role has “Log in using Access Tokens” and “REST Web Services”.",
      );
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= MAX_ATTEMPTS) throw new ConnectorError(`NetSuite is busy (HTTP ${res.status}). Try again in a minute.`);
      await deps.sleep(1000 * attempt);
      continue;
    }
    const json = (await res.json().catch(() => ({}))) as Doc & NsError;
    if (res.status === 403) throw new ConnectorError(`NetSuite: the token's role can't run this query. ${json["o:errorDetails"]?.[0]?.detail ?? "Give it SuiteAnalytics Workbook and view access to transactions and items."}`);
    if (!res.ok) throw new ConnectorError(`NetSuite: ${json["o:errorDetails"]?.[0]?.detail ?? json.title ?? `HTTP ${res.status}`}`);
    const items = ((json.items as Doc[] | undefined) ?? []).map((item) => {
      const row = { ...item };
      delete row.links; // NetSuite's self-links, not data
      return row;
    });
    return { items, hasMore: json.hasMore === true };
  }
}

export async function suiteql(creds: NetSuiteCredentials, deps: ConnectorDeps, sql: string): Promise<Doc[]> {
  const out: Doc[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { items, hasMore } = await suiteqlPage(creds, deps, sql, offset);
    out.push(...items);
    if (!hasMore || items.length === 0) return out;
    if (out.length >= MAX_ROWS) throw new ConnectorError("More than 100,000 rows in that period. Pull a shorter period.");
  }
}

// ─── Reports ──────────────────────────────────────────────────────────────────

/** A SuiteQL date literal for an ISO day (validated before it gets here). */
const day = (iso: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new ConnectorError("Bad date.");
  return `TO_DATE('${iso}', 'YYYY-MM-DD')`;
};
const between = (w: PullWindow) => `t.trandate >= ${day(w.from)} AND t.trandate <= ${day(w.to)}`;
const iso = (col: string, as: string) => `TO_CHAR(${col}, 'YYYY-MM-DD') AS ${as}`;

/** Header columns shared by every transaction query. */
const HEAD = `t.id, t.tranid, ${iso("t.trandate", "trandate")}, e.entityid AS entityno, BUILTIN.DF(t.entity) AS entityname, cur.symbol AS currency, BUILTIN.DF(t.status) AS status`;
const FROM = "FROM transaction t JOIN entity e ON e.id = t.entity LEFT JOIN currency cur ON cur.id = t.currency";
/** Item lines only: no header, tax, shipping or COGS lines. Amounts and quantities are signed by NetSuite; reports use ABS. */
const LINES = "JOIN transactionline tl ON tl.transaction = t.id JOIN item i ON i.id = tl.item";
const ITEM_LINE = "tl.mainline = 'F' AND tl.taxline = 'F' AND NVL(tl.iscogs, 'F') = 'F' AND tl.item IS NOT NULL";

type ReportSpec = {
  id: string;
  label: string;
  description: string;
  slots: string[];
  sql: (w: PullWindow) => string;
  columns: readonly string[];
  row: (r: Doc) => string[];
};

const abs = (v: unknown) => num(Math.abs(Number(v ?? 0)));

export const NS_REPORTS: ReportSpec[] = [
  {
    id: "sales_invoices",
    label: "Invoices",
    description: "Posted customer invoices dated in the period, with total, amount remaining and status.",
    slots: ["b2b-cash-application/invoices", "b2b_invoices", "sales"],
    sql: (w) => `SELECT ${HEAD}, t.otherrefnum, ${iso("t.duedate", "duedate")}, t.foreigntotal, t.foreignamountremaining ${FROM} WHERE t.type = 'CustInvc' AND t.posting = 'T' AND ${between(w)} ORDER BY t.id`,
    columns: ["Invoice number", "Customer PO no.", "Customer no.", "Customer", "Invoice date", "Due date", "Currency", "Invoice amount (incl. VAT)", "Open amount", "Status"],
    row: (r) => [str(r.tranid), str(r.otherrefnum), str(r.entityno), str(r.entityname), str(r.trandate), str(r.duedate), str(r.currency), num(r.foreigntotal ?? 0), num(r.foreignamountremaining ?? 0), str(r.status)],
  },
  {
    id: "sales_invoice_lines",
    label: "Invoice lines",
    description: "Item lines of posted invoices dated in the period, with the sales order, item, quantity and price.",
    slots: ["b2b-order-delivery-invoice/invoices", "invoice_lines"],
    sql: (w) =>
      `SELECT ${HEAD}, so.tranid AS salesorder, i.itemid AS sku, tl.memo, tl.quantity, tl.rate, tl.foreignamount ${FROM} ${LINES} LEFT JOIN transaction so ON so.id = t.createdfrom WHERE t.type = 'CustInvc' AND t.posting = 'T' AND ${ITEM_LINE} AND ${between(w)} ORDER BY t.id, tl.linesequencenumber`,
    columns: ["Invoice number", "Invoice date", "Customer no.", "Customer", "Sales order no.", "SKU", "Description", "Quantity", "Unit price", "Line amount", "Currency"],
    row: (r) => [str(r.tranid), str(r.trandate), str(r.entityno), str(r.entityname), str(r.salesorder), str(r.sku), str(r.memo), abs(r.quantity), abs(r.rate), abs(r.foreignamount), str(r.currency)],
  },
  {
    id: "sales_credit_memos",
    label: "Credit memos",
    description: "Posted credit memos dated in the period, with the invoice or return they came from.",
    slots: ["credit_notes"],
    sql: (w) => `SELECT ${HEAD}, src.tranid AS source, t.foreigntotal, t.foreignamountremaining ${FROM} LEFT JOIN transaction src ON src.id = t.createdfrom WHERE t.type = 'CustCred' AND t.posting = 'T' AND ${between(w)} ORDER BY t.id`,
    columns: ["Credit note no.", "Credit note date", "Original invoice no.", "Customer no.", "Customer", "Currency", "Credit amount", "Unused credit", "Status"],
    row: (r) => [str(r.tranid), str(r.trandate), str(r.source), str(r.entityno), str(r.entityname), str(r.currency), abs(r.foreigntotal), abs(r.foreignamountremaining), str(r.status)],
  },
  {
    id: "sales_order_lines",
    label: "Sales order lines",
    description: "Item lines of sales orders dated in the period, with quantities shipped and billed.",
    slots: ["b2b-order-delivery-invoice/orders"],
    sql: (w) => `SELECT ${HEAD}, t.otherrefnum, i.itemid AS sku, tl.memo, tl.quantity, tl.quantityshiprecv, tl.quantitybilled, tl.rate, tl.foreignamount ${FROM} ${LINES} WHERE t.type = 'SalesOrd' AND ${ITEM_LINE} AND ${between(w)} ORDER BY t.id, tl.linesequencenumber`,
    columns: ["Sales order no.", "Order date", "Customer PO no.", "Customer no.", "Customer", "SKU", "Description", "Qty ordered", "Qty delivered", "Qty invoiced", "Unit price", "Line amount", "Currency", "Status"],
    row: (r) => [str(r.tranid), str(r.trandate), str(r.otherrefnum), str(r.entityno), str(r.entityname), str(r.sku), str(r.memo), abs(r.quantity), abs(r.quantityshiprecv), abs(r.quantitybilled), abs(r.rate), abs(r.foreignamount), str(r.currency), str(r.status)],
  },
  {
    id: "sales_shipment_lines",
    label: "Item fulfillment lines",
    description: "Item fulfillments (delivery notes) dated in the period, line by line, with their sales order.",
    slots: ["deliveries"],
    sql: (w) => `SELECT ${HEAD}, so.tranid AS salesorder, i.itemid AS sku, tl.memo, tl.quantity ${FROM} ${LINES} LEFT JOIN transaction so ON so.id = t.createdfrom WHERE t.type = 'ItemShip' AND ${ITEM_LINE} AND ${between(w)} ORDER BY t.id, tl.linesequencenumber`,
    columns: ["Delivery note no.", "Sales order no.", "Delivery date", "Customer no.", "Customer", "SKU", "Description", "Qty delivered"],
    row: (r) => [str(r.tranid), str(r.salesorder), str(r.trandate), str(r.entityno), str(r.entityname), str(r.sku), str(r.memo), abs(r.quantity)],
  },
  {
    id: "purchase_order_lines",
    label: "Purchase order lines",
    description: "Item lines of purchase orders dated in the period, with quantities received and billed.",
    slots: ["po"],
    sql: (w) =>
      `SELECT ${HEAD}, ${iso("tl.expectedreceiptdate", "expected")}, i.itemid AS sku, tl.memo, tl.quantity, tl.quantityshiprecv, tl.quantitybilled, tl.rate, tl.foreignamount ${FROM} ${LINES} WHERE t.type = 'PurchOrd' AND ${ITEM_LINE} AND ${between(w)} ORDER BY t.id, tl.linesequencenumber`,
    columns: ["PO number", "PO date", "Vendor no.", "Supplier", "Expected delivery date", "SKU", "Description", "Qty ordered", "Qty received", "Qty invoiced", "PO unit price (excl. VAT)", "Line amount (excl. VAT)", "Currency", "Status"],
    row: (r) => [str(r.tranid), str(r.trandate), str(r.entityno), str(r.entityname), str(r.expected), str(r.sku), str(r.memo), abs(r.quantity), abs(r.quantityshiprecv), abs(r.quantitybilled), abs(r.rate), abs(r.foreignamount), str(r.currency), str(r.status)],
  },
  {
    id: "purchase_receipt_lines",
    label: "Item receipt lines (GRN)",
    description: "Item receipts dated in the period, line by line, with their purchase order.",
    slots: ["grn"],
    sql: (w) => `SELECT ${HEAD}, po.tranid AS po, i.itemid AS sku, tl.memo, tl.quantity ${FROM} ${LINES} LEFT JOIN transaction po ON po.id = t.createdfrom WHERE t.type = 'ItemRcpt' AND ${ITEM_LINE} AND ${between(w)} ORDER BY t.id, tl.linesequencenumber`,
    columns: ["GRN number", "PO number", "Received date", "Vendor no.", "Supplier", "SKU", "Description", "Qty received"],
    row: (r) => [str(r.tranid), str(r.po), str(r.trandate), str(r.entityno), str(r.entityname), str(r.sku), str(r.memo), abs(r.quantity)],
  },
  {
    id: "purchase_invoice_lines",
    label: "Vendor bill lines",
    description: "Item lines of posted vendor bills dated in the period, with the supplier's invoice number and purchase order.",
    slots: ["p2p-three-way-match/invoices"],
    sql: (w) =>
      `SELECT ${HEAD}, t.transactionnumber, po.tranid AS po, i.itemid AS sku, tl.memo, tl.quantity, tl.rate, tl.foreignamount ${FROM} ${LINES} LEFT JOIN transaction po ON po.id = t.createdfrom WHERE t.type = 'VendBill' AND t.posting = 'T' AND ${ITEM_LINE} AND ${between(w)} ORDER BY t.id, tl.linesequencenumber`,
    columns: ["Supplier invoice no.", "Posted invoice no.", "Invoice date", "PO number", "Vendor no.", "Supplier", "SKU", "Description", "Qty invoiced", "Unit cost", "Line amount (excl. VAT)", "Currency"],
    row: (r) => [str(r.tranid), str(r.transactionnumber), str(r.trandate), str(r.po), str(r.entityno), str(r.entityname), str(r.sku), str(r.memo), abs(r.quantity), abs(r.rate), abs(r.foreignamount), str(r.currency)],
  },
  {
    id: "items",
    label: "Items (quantity on hand)",
    description: "Every active inventory item with its total quantity on hand. Not dated: it's the list right now.",
    slots: ["web-erp-stock/erp_stock"],
    sql: () => "SELECT i.itemid AS sku, i.displayname, i.itemtype, i.totalquantityonhand FROM item i WHERE i.isinactive = 'F' AND i.itemtype = 'InvtPart' ORDER BY i.itemid",
    columns: ["SKU", "Description", "Type", "Inventory"],
    row: (r) => [str(r.sku), str(r.displayname || r.sku), str(r.itemtype), num(r.totalquantityonhand ?? 0)],
  },
];

// ─── Connector ────────────────────────────────────────────────────────────────

const secret = (v: string | undefined, what: string) => {
  const s = (v ?? "").trim();
  if (!/^[0-9a-f]{64}$/i.test(s)) throw new ConnectorError(`Paste the full ${what} (64 characters, shown once when it was created).`);
  return s.toLowerCase();
};

export const netsuite: Connector<NetSuiteCredentials> = {
  id: "netsuite",
  label: "NetSuite",
  description: "Oracle NetSuite: invoices, credit memos, sales orders, fulfillments, purchase orders, item receipts, vendor bills and items for the B2B and purchasing reconciliations. Read-only.",
  fields: [
    { key: "accountId", label: "Account ID", secret: false, placeholder: "1234567 or 1234567_SB1", help: "Setup → Company → Company Information → Account ID." },
    { key: "consumerKey", label: "Consumer key", secret: false, help: "Setup → Integration → Manage Integrations → New, with Token-Based Authentication ticked. Shown once on save." },
    { key: "consumerSecret", label: "Consumer secret", secret: true },
    { key: "tokenId", label: "Token ID", secret: false, help: "Setup → Users/Roles → Access Tokens → New, for that integration and a role with Log in using Access Tokens, REST Web Services and SuiteAnalytics Workbook." },
    { key: "tokenSecret", label: "Token secret", secret: true },
  ],
  reports: NS_REPORTS.map(({ id, label, description, slots }) => ({ id, label, description, slots })),

  parseCredentials(input) {
    return {
      accountId: normaliseAccount(input.accountId ?? ""),
      consumerKey: secret(input.consumerKey, "consumer key"),
      consumerSecret: secret(input.consumerSecret, "consumer secret"),
      tokenId: secret(input.tokenId, "token ID"),
      tokenSecret: secret(input.tokenSecret, "token secret"),
    };
  },

  async test(creds, deps) {
    // A cheap query any role with SuiteQL access can run.
    await suiteql(creds, deps, "SELECT COUNT(*) AS n FROM currency");
    return { accountLabel: `NetSuite ${creds.accountId}${/_SB/.test(creds.accountId) ? " (Sandbox)" : ""}` };
  },

  async pull(creds, report, window, deps) {
    const spec = NS_REPORTS.find((r) => r.id === report);
    if (!spec) throw new ConnectorError(`Unknown NetSuite report: ${report}`);
    const rows = (await suiteql(creds, deps, spec.sql(window))).map(spec.row);
    return { headers: [...spec.columns], rows };
  },
};
