import { num, str } from "./format";
import { ConnectorError, type Connector, type ConnectorDeps, type ErpDocumentRef, type ErpMasterData, type ErpPurchaseInvoice, type JournalWriter, type PullWindow, type PurchaseInvoiceWriter } from "./types";

// Microsoft Dynamics 365 Business Central (online), standard API v2.0 (D-29).
//
// Auth: service-to-service (OAuth client credentials). The customer registers an app in
// Microsoft Entra ID with the Business Central "API.ReadWrite.All" application permission
// (there is no read-only scope), then in Business Central adds it on the "Microsoft Entra
// Applications" page, enabled, with a read-only permission set (e.g. D365 READ). What the
// app can do is decided by that permission set; Sawwi only ever sends GET requests.
//
// Both hosts are fixed (login.microsoftonline.com, api.businesscentral.dynamics.com) and the
// tenant and environment are validated, so a connection can never point the server anywhere
// else. Paging follows @odata.nextLink, which must stay on the API host.
//
// Docs: https://learn.microsoft.com/dynamics365/business-central/dev-itpro/api-reference/v2.0/
//       https://learn.microsoft.com/dynamics365/business-central/dev-itpro/administration/automation-apis-using-s2s-authentication

export const BC_LOGIN_HOST = "https://login.microsoftonline.com";
export const BC_API_HOST = "https://api.businesscentral.dynamics.com";
export const BC_SCOPE = `${BC_API_HOST}/.default`;
const MAX_ATTEMPTS = 5;
const MAX_ROWS = 200_000;

export type BusinessCentralCredentials = { tenantId: string; environment: string; clientId: string; clientSecret: string; company: string };

type Doc = Record<string, unknown>;
type Company = { id: string; name: string; displayName: string };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function normaliseTenant(input: string): string {
  const t = input.trim().toLowerCase();
  if (!GUID.test(t) && !DOMAIN.test(t)) throw new ConnectorError("Enter your Microsoft Entra tenant ID (a GUID) or primary domain, e.g. contoso.onmicrosoft.com.");
  return t;
}

export function normaliseEnvironment(input: string): string {
  const e = input.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,29}$/.test(e)) throw new ConnectorError("Enter the Business Central environment name, e.g. Production or Sandbox.");
  return e;
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

const AADSTS: [RegExp, string][] = [
  [/AADSTS(90002|900023)\b/, "Microsoft can't find that tenant. Check the tenant ID or domain."],
  [/AADSTS700016\b/, "No app with that client ID in this tenant. Check the Application (client) ID in Microsoft Entra."],
  [/AADSTS7000215\b/, "Microsoft didn't accept the client secret. Paste the secret's Value (not its ID), or create a new one."],
  [/AADSTS7000222\b/, "The client secret has expired. Create a new one in Microsoft Entra and update this connection."],
];

async function accessToken(creds: BusinessCentralCredentials, deps: ConnectorDeps): Promise<string> {
  const url = `${BC_LOGIN_HOST}/${encodeURIComponent(creds.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: creds.clientId, client_secret: creds.clientSecret, scope: BC_SCOPE }).toString();
  for (let attempt = 1; ; attempt++) {
    const res = await deps.fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
      await deps.sleep(1000 * attempt);
      continue;
    }
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
    if (res.ok && json.access_token) return json.access_token;
    const text = `${json.error ?? ""} ${json.error_description ?? ""}`;
    for (const [re, message] of AADSTS) if (re.test(text)) throw new ConnectorError(message);
    if (json.error === "invalid_client" || json.error === "unauthorized_client") throw new ConnectorError("Microsoft didn't accept the client ID and secret.");
    throw new ConnectorError(`Microsoft sign-in failed (HTTP ${res.status}).`);
  }
}

type Session = { creds: BusinessCentralCredentials; token: string; deps: ConnectorDeps };

const apiRoot = (c: BusinessCentralCredentials) => `${BC_API_HOST}/v2.0/${encodeURIComponent(c.tenantId)}/${encodeURIComponent(c.environment)}/api/v2.0`;

async function getJson(s: Session, url: string): Promise<{ value?: Doc[]; "@odata.nextLink"?: string }> {
  if (!url.startsWith(`${BC_API_HOST}/`)) throw new ConnectorError("Business Central sent a link to another host; stopped.");
  for (let attempt = 1; ; attempt++) {
    const res = await s.deps.fetch(url, { method: "GET", headers: { Authorization: `Bearer ${s.token}`, Accept: "application/json" } });
    if (res.status === 401) {
      throw new ConnectorError(
        "Business Central rejected the app. In Business Central, open “Microsoft Entra Applications”, add this client ID, set it to Enabled and grant consent.",
      );
    }
    if (res.status === 403) throw new ConnectorError("The app can't read this data. Give it a read-only permission set such as D365 READ in Business Central.");
    if (res.status === 404) throw new ConnectorError(`No Business Central environment named “${s.creds.environment}” answered in this tenant.`);
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= MAX_ATTEMPTS) throw new ConnectorError(`Business Central is busy (HTTP ${res.status}). Try again in a minute.`);
      const after = Number(res.headers.get("Retry-After"));
      await s.deps.sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * attempt);
      continue;
    }
    const json = (await res.json().catch(() => ({}))) as { value?: Doc[]; "@odata.nextLink"?: string; error?: { message?: string } };
    if (!res.ok) throw new ConnectorError(`Business Central: ${json.error?.message ?? `HTTP ${res.status}`}`);
    return json;
  }
}

async function* allPages(s: Session, url: string): AsyncGenerator<Doc[]> {
  let next: string | undefined = url;
  while (next) {
    const page = await getJson(s, next);
    yield page.value ?? [];
    next = page["@odata.nextLink"];
  }
}

async function openSession(creds: BusinessCentralCredentials, deps: ConnectorDeps): Promise<Session> {
  return { creds, deps, token: await accessToken(creds, deps) };
}

export function pickCompany(companies: Company[], wanted: string): Company {
  const w = wanted.trim().toLowerCase();
  if (!w) {
    if (companies.length === 1) return companies[0];
    const names = companies.slice(0, 6).map((c) => c.displayName || c.name);
    throw new ConnectorError(companies.length ? `This environment has several companies; enter one of: ${names.join(", ")}.` : "This environment has no companies.");
  }
  const hit = companies.find((c) => c.id.toLowerCase() === w || c.name.toLowerCase() === w || (c.displayName ?? "").toLowerCase() === w);
  if (!hit) throw new ConnectorError(`No company called “${wanted.trim()}” in this environment.`);
  return hit;
}

async function company(s: Session): Promise<Company> {
  const page = await getJson(s, `${apiRoot(s.creds)}/companies`);
  return pickCompany((page.value ?? []) as Company[], s.creds.company);
}

// ─── Reports ──────────────────────────────────────────────────────────────────

const lines = (d: Doc, key: string) => ((d[key] as Doc[] | undefined) ?? []).filter((l) => l.lineType !== "Comment");
/** Unposted documents ("Draft", "In Review") are not in the books yet. */
const posted = (d: Doc) => !["", " ", "Draft", "In Review"].includes(str(d.status));
const currency = (d: Doc, lcy: string) => str(d.currencyCode) || lcy;

/** Invoice lines don't carry the shipment in API v2.0, so find it from the order: */
type ShipmentIndex = Map<string, { dn: string; qty: number }[]>;
export function deliveryNoteFor(index: ShipmentIndex, order: string, item: string, qty: number): string {
  const candidates = index.get(`${order}\u0000${item}`) ?? [];
  if (candidates.length === 1) return candidates[0].dn; // the order shipped this item once
  const exact = candidates.filter((c) => c.qty === qty);
  return exact.length === 1 ? exact[0].dn : ""; // otherwise only an unambiguous quantity match
}

type Rate = { currency: string; from: string; lcyPerUnit: number };
type Ctx = { lcy: string; shipments?: ShipmentIndex; rates?: Rate[] };

/**
 * LCY per unit of a currency on a date, from the currency exchange rates table. API v2.0 posted
 * invoices carry no currency factor, so this is the rate BC would apply on that posting date (D-58).
 */
export function lcyRate(rates: Rate[], currency: string, date: string, lcy: string): number | undefined {
  if (!currency || currency === lcy) return 1;
  const hit = rates.filter((r) => r.currency === currency && r.from <= date).sort((a, b) => b.from.localeCompare(a.from))[0];
  return hit?.lcyPerUnit;
}
type ReportSpec = {
  id: string;
  label: string;
  description: string;
  slots: string[];
  entity: string;
  /** Master data (items) has none: the report is the current state, whatever the window. */
  dateField?: string;
  expand?: string;
  keep?: (d: Doc) => boolean;
  needsShipments?: boolean;
  needsRates?: boolean;
  columns: readonly string[];
  rows: (d: Doc, ctx: Ctx) => string[][];
};

export const BC_REPORTS: ReportSpec[] = [
  {
    id: "sales_invoices",
    label: "Sales invoices",
    description: "Posted sales invoices in the period, with open amount and status.",
    slots: ["b2b-cash-application/invoices", "b2b_invoices", "sales"],
    entity: "salesInvoices",
    dateField: "postingDate",
    keep: posted,
    columns: ["Invoice number", "External document no.", "Order no.", "Customer no.", "Customer", "Invoice date", "Posting date", "Due date", "Currency", "Amount excl. VAT", "VAT amount", "Invoice amount (incl. VAT)", "Open amount", "Status"],
    rows: (d, { lcy }) => [
      [str(d.number), str(d.externalDocumentNumber), str(d.orderNumber), str(d.customerNumber), str(d.customerName), str(d.invoiceDate), str(d.postingDate), str(d.dueDate), currency(d, lcy), num(d.totalAmountExcludingTax), num(d.totalTaxAmount), num(d.totalAmountIncludingTax), num(d.remainingAmount), str(d.status)],
    ],
  },
  {
    id: "sales_invoice_lines",
    label: "Sales invoice lines",
    description: "Posted sales invoice lines with order, delivery note, item, quantity and price.",
    slots: ["b2b-order-delivery-invoice/invoices", "invoice_lines"],
    entity: "salesInvoices",
    dateField: "postingDate",
    expand: "salesInvoiceLines",
    keep: posted,
    needsShipments: true,
    columns: ["Invoice number", "Invoice date", "Customer no.", "Customer", "Sales order no.", "Delivery note no.", "SKU", "Description", "Quantity", "Unit price", "Discount %", "Line amount", "VAT amount", "Amount incl. VAT", "Currency"],
    rows: (d, { lcy, shipments }) =>
      lines(d, "salesInvoiceLines").map((l) => [
        str(d.number), str(d.invoiceDate), str(d.customerNumber), str(d.customerName), str(d.orderNumber),
        d.orderNumber && shipments ? deliveryNoteFor(shipments, str(d.orderNumber), str(l.lineObjectNumber), Number(l.quantity)) : "",
        str(l.lineObjectNumber), str(l.description), num(l.quantity), num(l.unitPrice), num(l.discountPercent), num(l.netAmount ?? l.amountExcludingTax), num(l.netTaxAmount ?? l.totalTaxAmount), num(l.netAmountIncludingTax ?? l.amountIncludingTax), currency(d, lcy),
      ]),
  },
  {
    id: "sales_credit_memos",
    label: "Sales credit memos",
    description: "Posted credit memos in the period, with the invoice they correct.",
    slots: ["credit_notes"],
    entity: "salesCreditMemos",
    dateField: "postingDate",
    keep: posted,
    columns: ["Credit note no.", "Credit note date", "Original invoice no.", "External document no.", "Customer no.", "Customer", "Currency", "Amount excl. VAT", "VAT amount", "Credit amount", "Status"],
    rows: (d, { lcy }) => [
      [str(d.number), str(d.creditMemoDate || d.postingDate), str(d.invoiceNumber), str(d.externalDocumentNumber), str(d.customerNumber), str(d.customerName), currency(d, lcy), num(d.totalAmountExcludingTax), num(d.totalTaxAmount), num(d.totalAmountIncludingTax), str(d.status)],
    ],
  },
  {
    id: "web_sales_invoices",
    label: "Posted sales invoices for web orders",
    description: "Posted sales invoices in the period that carry a web store order number (External Document No.), with the customer's e-mail, VAT and total.",
    slots: ["web-erp-invoices/erp_invoices"],
    entity: "salesInvoices",
    dateField: "postingDate",
    keep: (d) => posted(d) && str(d.externalDocumentNumber).trim() !== "",
    columns: ["Posted invoice no.", "Store order no. (external document no.)", "Posting date", "Invoice date", "Customer no.", "Customer", "Customer e-mail", "Currency", "Amount excl. VAT", "VAT amount", "Amount incl. VAT", "Status"],
    rows: (d, { lcy }) => [
      [str(d.number), str(d.externalDocumentNumber).trim(), str(d.postingDate), str(d.invoiceDate), str(d.customerNumber), str(d.customerName), str(d.email), currency(d, lcy), num(d.totalAmountExcludingTax), num(d.totalTaxAmount), num(d.totalAmountIncludingTax), str(d.status)],
    ],
  },
  {
    id: "web_sales_invoices_fx",
    label: "Posted web invoices in document and local currency",
    description: "Posted sales invoices for web orders with their currency, the amount in that currency, the exchange rate on the posting date and the amount in local currency, plus the store dimension (Global Dimension 1).",
    slots: ["web-erp-fx/erp_invoices"],
    entity: "salesInvoices",
    dateField: "postingDate",
    keep: (d) => posted(d) && str(d.externalDocumentNumber).trim() !== "",
    needsRates: true,
    columns: ["Posted invoice no.", "Store order no. (external document no.)", "Posting date", "Store (dimension 1)", "Invoice currency", "Amount incl. VAT (FCY)", "Exchange rate (LCY per unit)", "Amount incl. VAT (LCY)"],
    rows: (d, { lcy, rates }) => {
      const cur = currency(d, lcy);
      const rate = lcyRate(rates ?? [], cur, str(d.postingDate), lcy);
      const fcy = Number(d.totalAmountIncludingTax ?? 0);
      return [[str(d.number), str(d.externalDocumentNumber).trim(), str(d.postingDate), str(d.shortcutDimension1Code), cur, num(fcy), rate === undefined ? "" : num(rate), rate === undefined ? "" : num(Math.round(fcy * rate * 100) / 100)]];
    },
  },
  {
    id: "web_sales_credit_memos",
    label: "Posted sales credit memos for web refunds",
    description: "Posted sales credit memos in the period that carry a web store order number (External Document No.), with the customer's e-mail, VAT and total.",
    slots: ["web-erp-credit-memos/erp_credit_notes"],
    entity: "salesCreditMemos",
    dateField: "postingDate",
    keep: (d) => posted(d) && str(d.externalDocumentNumber).trim() !== "",
    columns: ["Posted credit memo no.", "Store order no. (external document no.)", "Posting date", "Credit memo date", "Applies-to invoice no.", "Customer no.", "Customer", "Customer e-mail", "Currency", "Amount excl. VAT", "VAT amount", "Credit amount incl. VAT", "Status"],
    rows: (d, { lcy }) => [
      [str(d.number), str(d.externalDocumentNumber).trim(), str(d.postingDate), str(d.creditMemoDate), str(d.invoiceNumber), str(d.customerNumber), str(d.customerName), str(d.email), currency(d, lcy), num(d.totalAmountExcludingTax), num(d.totalTaxAmount), num(d.totalAmountIncludingTax), str(d.status)],
    ],
  },
  {
    id: "items",
    label: "Items (inventory and unit price)",
    description: "Every item with its current inventory, base unit and unit price. Not dated: it's the item list right now.",
    slots: ["web-erp-stock/erp_stock", "web-erp-prices/erp_prices"],
    entity: "items",
    columns: ["SKU", "Description", "Type", "Inventory", "Base unit", "Unit price", "Price includes VAT", "Blocked", "GTIN"],
    rows: (d) => [
      [str(d.number), str(d.displayName), str(d.type), num(d.inventory ?? 0), str(d.baseUnitOfMeasureCode), num(d.unitPrice ?? 0), d.priceIncludesTax ? "Yes" : "No", d.blocked ? "Yes" : "No", str(d.gtin)],
    ],
  },
  {
    id: "sales_order_lines",
    label: "Sales order lines (open orders)",
    description: "Lines of sales orders dated in the period that are still open. Business Central deletes an order once it is fully invoiced.",
    slots: ["b2b-order-delivery-invoice/orders"],
    entity: "salesOrders",
    dateField: "orderDate",
    expand: "salesOrderLines",
    columns: ["Sales order no.", "Order date", "Customer PO no.", "Customer no.", "Customer", "SKU", "Description", "Qty ordered", "Qty delivered", "Qty invoiced", "Unit price", "Line amount", "Currency", "Status"],
    rows: (d, { lcy }) =>
      lines(d, "salesOrderLines").map((l) => [
        str(d.number), str(d.orderDate), str(d.externalDocumentNumber), str(d.customerNumber), str(d.customerName), str(l.lineObjectNumber), str(l.description), num(l.quantity), num(l.shippedQuantity), num(l.invoicedQuantity), num(l.unitPrice), num(l.netAmount ?? l.amountExcludingTax), currency(d, lcy), str(d.status),
      ]),
  },
  {
    id: "sales_shipment_lines",
    label: "Sales shipment lines",
    description: "Posted shipments (delivery notes) in the period, line by line, with their sales order.",
    slots: ["deliveries"],
    entity: "salesShipments",
    dateField: "postingDate",
    expand: "salesShipmentLines",
    columns: ["Delivery note no.", "Sales order no.", "Delivery date", "Customer no.", "Customer", "SKU", "Description", "Qty delivered", "Unit price"],
    rows: (d) =>
      lines(d, "salesShipmentLines")
        .filter((l) => str(l.lineType) !== " ")
        .map((l) => [str(d.number), str(d.orderNumber), str(d.postingDate), str(d.customerNumber), str(d.customerName), str(l.lineObjectNumber), str(l.description), num(l.quantity), num(l.unitPrice)]),
  },
  {
    id: "purchase_order_lines",
    label: "Purchase order lines (open orders)",
    description: "Lines of purchase orders dated in the period that are still open, with quantities received and invoiced.",
    slots: ["po"],
    entity: "purchaseOrders",
    dateField: "orderDate",
    expand: "purchaseOrderLines",
    columns: ["PO number", "PO date", "Vendor no.", "Supplier", "Expected delivery date", "SKU", "Description", "Qty ordered", "Qty received", "Qty invoiced", "PO unit price (excl. VAT)", "Line amount (excl. VAT)", "Currency", "Status"],
    rows: (d, { lcy }) =>
      lines(d, "purchaseOrderLines").map((l) => [
        str(d.number), str(d.orderDate), str(d.vendorNumber), str(d.vendorName), str(l.expectedReceiptDate || d.requestedReceiptDate), str(l.lineObjectNumber), str(l.description), num(l.quantity), num(l.receivedQuantity), num(l.invoicedQuantity), num(l.directUnitCost), num(l.netAmount ?? l.amountExcludingTax), currency(d, lcy), str(d.status),
      ]),
  },
  {
    id: "purchase_receipt_lines",
    label: "Purchase receipt lines (GRN)",
    description: "Posted goods receipts in the period, line by line, with their purchase order.",
    slots: ["grn"],
    entity: "purchaseReceipts",
    dateField: "postingDate",
    expand: "purchaseReceiptLines",
    columns: ["GRN number", "PO number", "Received date", "Vendor no.", "Supplier", "SKU", "Description", "Qty received", "Unit cost"],
    rows: (d) =>
      lines(d, "purchaseReceiptLines")
        .filter((l) => str(l.lineType) !== " ")
        .map((l) => [str(d.number), str(d.orderNumber), str(d.postingDate), str(d.vendorNumber), str(d.vendorName), str(l.lineObjectNumber), str(l.description), num(l.quantity), num(l.unitCost)]),
  },
  {
    id: "purchase_invoice_lines",
    label: "Purchase invoice lines",
    description: "Posted vendor invoices in the period, line by line, with the vendor's invoice number and purchase order.",
    slots: ["p2p-three-way-match/invoices"],
    entity: "purchaseInvoices",
    dateField: "postingDate",
    expand: "purchaseInvoiceLines",
    keep: posted,
    columns: ["Supplier invoice no.", "Posted invoice no.", "Invoice date", "PO number", "Vendor no.", "Supplier", "SKU", "Description", "Qty invoiced", "Unit cost", "Line amount (excl. VAT)", "VAT amount", "Amount incl. VAT", "Currency"],
    rows: (d, { lcy }) =>
      lines(d, "purchaseInvoiceLines").map((l) => [
        str(d.vendorInvoiceNumber || d.number), str(d.number), str(d.invoiceDate), str(d.orderNumber), str(d.vendorNumber), str(d.vendorName), str(l.lineObjectNumber), str(l.description), num(l.quantity), num(l.unitCost), num(l.netAmount ?? l.amountExcludingTax), num(l.netTaxAmount ?? l.totalTaxAmount), num(l.netAmountIncludingTax ?? l.amountIncludingTax), currency(d, lcy),
      ]),
  },
];

/** OData filter for a window of whole days, both ends inclusive (Edm.Date literals are unquoted). */
export function windowFilter(field: string, w: PullWindow): string {
  return `${field} ge ${w.from} and ${field} le ${w.to}`;
}

function entityUrl(s: Session, companyId: string, spec: { entity: string; dateField?: string; expand?: string }, w: PullWindow): string {
  const params = spec.dateField ? [`$filter=${encodeURIComponent(windowFilter(spec.dateField, w))}`] : [];
  if (spec.expand) params.push(`$expand=${spec.expand}`);
  const url = `${apiRoot(s.creds)}/companies(${companyId})/${spec.entity}`;
  return params.length ? `${url}?${params.join("&")}` : url;
}

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Shipments from 90 days before the period up to its end, indexed by order and item. */
async function shipmentIndex(s: Session, companyId: string, w: PullWindow): Promise<ShipmentIndex> {
  const index: ShipmentIndex = new Map();
  const url = entityUrl(s, companyId, { entity: "salesShipments", dateField: "postingDate", expand: "salesShipmentLines" }, { from: addDays(w.from, -90), to: w.to });
  for await (const page of allPages(s, url)) {
    for (const d of page) {
      for (const l of lines(d, "salesShipmentLines")) {
        const key = `${str(d.orderNumber)}\u0000${str(l.lineObjectNumber)}`;
        index.set(key, [...(index.get(key) ?? []), { dn: str(d.number), qty: Number(l.quantity) }]);
      }
    }
  }
  return index;
}

/** The whole currency exchange rates table (it is small): LCY per unit = relational ÷ exchange rate amount. */
async function exchangeRates(s: Session, companyId: string): Promise<Rate[]> {
  const out: Rate[] = [];
  for await (const page of allPages(s, `${apiRoot(s.creds)}/companies(${companyId})/currencyExchangeRates`)) {
    for (const r of page) {
      const amount = Number(r.exchangeRateAmount ?? 0);
      if (amount) out.push({ currency: str(r.currencyCode), from: str(r.startingDate), lcyPerUnit: Number(r.relationalExchangeRateAmount ?? 0) / amount });
    }
  }
  return out;
}

// ─── Writes: draft purchase invoices (D-64) ──────────────────────────────────
//
// The only write. Sawwi creates an unposted purchase invoice and its lines, reads it back for
// BC's own total, and deletes it again (by id, only that one) if a line fails. It never posts,
// releases, or changes any other document. URLs are built on the fixed API host only, and live
// requests go through liveDeps (assertPublicUrl, no redirects).

const WRITE_FORBIDDEN =
  "Business Central didn't let the app create a purchase invoice. In Business Central, give the app (on “Microsoft Entra Applications”) a permission set that can create purchase documents, such as D365 PURCH DOC, EDIT, next to D365 READ.";

async function sendJson(s: Session, method: "POST" | "DELETE", url: string, body?: unknown): Promise<Doc> {
  if (!url.startsWith(`${BC_API_HOST}/`)) throw new ConnectorError("Refused to write outside Business Central's API host.");
  const headers: Record<string, string> = { Authorization: `Bearer ${s.token}`, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method === "DELETE") headers["If-Match"] = "*";
  for (let attempt = 1; ; attempt++) {
    const res = await s.deps.fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 401) throw new ConnectorError("Business Central rejected the app. Check it's enabled on “Microsoft Entra Applications”.");
    if (res.status === 403) throw new ConnectorError(WRITE_FORBIDDEN);
    // Only "too many requests" is retried: it wasn't processed. A 5xx on a POST may have been, so it isn't.
    if (res.status === 429 && attempt < MAX_ATTEMPTS) {
      const after = Number(res.headers.get("Retry-After"));
      await s.deps.sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * attempt);
      continue;
    }
    const json = (await res.json().catch(() => ({}))) as Doc & { error?: { message?: string } };
    if (!res.ok) throw new ConnectorError(`Business Central: ${json.error?.message ?? `HTTP ${res.status}`}`);
    return json;
  }
}

/** An OData string literal: single quotes doubled. */
const odataString = (v: string) => `'${v.replace(/'/g, "''")}'`;

async function companyContext(s: Session) {
  const c = await company(s);
  const info = await getJson(s, `${apiRoot(s.creds)}/companies(${c.id})/companyInformation`);
  return { c, root: `${apiRoot(s.creds)}/companies(${c.id})`, lcy: str(info.value?.[0]?.currencyCode), name: c.displayName || c.name };
}

async function collect(s: Session, url: string): Promise<Doc[]> {
  const out: Doc[] = [];
  for await (const page of allPages(s, url)) {
    out.push(...page);
    if (out.length > MAX_ROWS) throw new ConnectorError("More than 200,000 records; Sawwi stopped reading.");
  }
  return out;
}

export const bcPurchaseInvoices: PurchaseInvoiceWriter<BusinessCentralCredentials> = {
  async masterData(creds, deps): Promise<ErpMasterData> {
    const s = await openSession(creds, deps);
    const { root, lcy, name } = await companyContext(s);
    const open = (d: Doc) => !d.blocked || d.blocked === " " || d.blocked === "_x0020_";
    const [vendors, items, accounts] = await Promise.all([collect(s, `${root}/vendors`), collect(s, `${root}/items`), collect(s, `${root}/accounts`)]);
    return {
      company: name,
      lcy,
      vendors: vendors.filter(open).map((v) => ({ number: str(v.number), name: str(v.displayName), trn: str(v.taxRegistrationNumber), currency: str(v.currencyCode) })),
      items: items.filter(open).map((i) => ({ number: str(i.number), name: str(i.displayName), gtin: str(i.gtin) })),
      accounts: accounts
        .filter((a) => open(a) && a.directPosting !== false && (a.accountType ?? "Posting") === "Posting")
        .map((a) => ({ number: str(a.number), name: str(a.displayName) })),
    };
  },

  async findExisting(creds, vendorNumber, vendorInvoiceNumber, deps): Promise<ErpDocumentRef[]> {
    const s = await openSession(creds, deps);
    const { root } = await companyContext(s);
    const filter = `vendorNumber eq ${odataString(vendorNumber)} and vendorInvoiceNumber eq ${odataString(vendorInvoiceNumber)}`;
    const docs = await collect(s, `${root}/purchaseInvoices?$filter=${encodeURIComponent(filter)}`);
    return docs.map((d) => ({ id: str(d.id), number: str(d.number), status: str(d.status) }));
  },

  async createDraft(creds, inv: ErpPurchaseInvoice, deps) {
    const s = await openSession(creds, deps);
    const { root, lcy, name } = await companyContext(s);
    const header: Doc = { vendorNumber: inv.vendorNumber, vendorInvoiceNumber: inv.vendorInvoiceNumber, invoiceDate: inv.invoiceDate };
    if (inv.dueDate) header.dueDate = inv.dueDate;
    if (inv.currency && inv.currency !== lcy) header.currencyCode = inv.currency;
    const created = await sendJson(s, "POST", `${root}/purchaseInvoices`, header);
    const id = str(created.id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ConnectorError("Business Central didn't return the new invoice's id.");
    const doc = `${root}/purchaseInvoices(${id})`;
    try {
      for (const l of inv.lines) {
        const line: Doc = { lineType: l.type === "item" ? "Item" : "Account", lineObjectNumber: l.number, quantity: l.quantity, directUnitCost: l.directUnitCost };
        // Item lines keep Business Central's item description; account lines need the supplier's text.
        if (l.type === "account" && l.description) line.description = l.description.slice(0, 100);
        await sendJson(s, "POST", `${doc}/purchaseInvoiceLines`, line);
      }
    } catch (error) {
      await sendJson(s, "DELETE", doc).catch(() => undefined);
      throw error;
    }
    const back = (await getJson(s, doc)) as Doc;
    const total = Number(back.totalAmountIncludingTax);
    return { id, number: str(back.number ?? created.number), status: str(back.status ?? "Draft"), company: name, totalIncludingTax: Number.isFinite(total) ? total : null };
  },
};

// ─── Writes: unposted general journal lines (D-71) ─────────────────────────────

const JOURNAL_FORBIDDEN =
  "Business Central didn't let the app add journal lines. Give the app (on “Microsoft Entra Applications”) a permission set that can edit general journals, such as D365 JOURNALS, EDIT, next to D365 READ.";

export const bcJournals: JournalWriter<BusinessCentralCredentials> = {
  async accounts(creds, deps) {
    const s = await openSession(creds, deps);
    const { root, lcy, name } = await companyContext(s);
    const open = (d: Doc) => !d.blocked && d.directPosting !== false && (d.accountType ?? "Posting") === "Posting";
    return { company: name, lcy, accounts: (await collect(s, `${root}/accounts`)).filter(open).map((a) => ({ number: str(a.number), name: str(a.displayName) })) };
  },

  async listJournals(creds, deps) {
    const s = await openSession(creds, deps);
    const { root } = await companyContext(s);
    return (await collect(s, `${root}/journals`)).map((j) => ({ id: str(j.id), code: str(j.code), name: str(j.displayName) || str(j.code) }));
  },

  async findDocument(creds, journalId, documentNumber, deps) {
    const s = await openSession(creds, deps);
    const { root } = await companyContext(s);
    if (!GUID.test(journalId)) throw new ConnectorError("Pick the journal batch again.");
    const filter = encodeURIComponent(`documentNumber eq ${odataString(documentNumber)}`);
    const unposted = await collect(s, `${root}/journals(${journalId})/journalLines?$filter=${filter}`);
    const posted = await collect(s, `${root}/generalLedgerEntries?$filter=${filter}`);
    return [
      ...(unposted.length ? [{ where: "unposted" as const, detail: `${unposted.length} unposted line${unposted.length === 1 ? "" : "s"} in the journal batch` }] : []),
      ...(posted.length ? [{ where: "posted" as const, detail: `posted on ${str(posted[0].postingDate)}` }] : []),
    ];
  },

  async createLines(creds, journalId, lines, deps) {
    const s = await openSession(creds, deps);
    const { root, name } = await companyContext(s);
    if (!GUID.test(journalId)) throw new ConnectorError("Pick the journal batch again.");
    const base = `${root}/journals(${journalId})/journalLines`;
    const created: string[] = [];
    try {
      for (const l of lines) {
        const res = await sendJson(s, "POST", base, {
          accountType: "G/L Account",
          accountNumber: l.accountNumber,
          postingDate: l.postingDate,
          documentNumber: l.documentNumber.slice(0, 20),
          externalDocumentNumber: l.externalDocumentNumber.slice(0, 35),
          amount: l.amount,
          description: l.description.slice(0, 100),
        }).catch((error: unknown) => {
          throw error instanceof ConnectorError && /didn't let the app create a purchase invoice/.test(error.message) ? new ConnectorError(JOURNAL_FORBIDDEN) : error;
        });
        const id = str(res.id);
        if (/^[0-9a-f-]{36}$/i.test(id)) created.push(id);
      }
    } catch (error) {
      // Only the lines this push added, by id.
      for (const id of created) await sendJson(s, "DELETE", `${base}(${id})`).catch(() => undefined);
      throw error;
    }
    const batch = (await collect(s, `${root}/journals`)).find((j) => str(j.id) === journalId);
    return { company: name, journal: str(batch?.code) || "journal", count: created.length };
  },
};

export const businessCentral: Connector<BusinessCentralCredentials> = {
  id: "business-central",
  label: "Business Central",
  description: "Microsoft Dynamics 365 Business Central (online): sales and purchase documents and items for the B2B, purchasing and web store reconciliations, and draft purchase invoices from Automation.",
  fields: [
    { key: "tenantId", label: "Tenant ID or domain", secret: false, placeholder: "contoso.onmicrosoft.com or 00000000-0000-…", help: "Microsoft Entra admin center → Overview → Tenant ID." },
    { key: "environment", label: "Environment", secret: false, placeholder: "Production", help: "As shown in the Business Central admin center, e.g. Production or Sandbox." },
    { key: "clientId", label: "Application (client) ID", secret: false, placeholder: "00000000-0000-0000-0000-000000000000" },
    {
      key: "clientSecret",
      label: "Client secret",
      secret: true,
      help: "In Microsoft Entra: App registrations → your app → Certificates & secrets → New client secret; paste its Value. In Business Central, add the app on “Microsoft Entra Applications”, enabled, with a read-only permission set such as D365 READ.",
    },
    { key: "company", label: "Company", secret: false, optional: true, placeholder: "Leave empty if there is only one", help: "The company name as shown in Business Central." },
  ],
  reports: BC_REPORTS.map(({ id, label, description, slots }) => ({ id, label, description, slots })),

  parseCredentials(input) {
    const clientId = (input.clientId ?? "").trim().toLowerCase();
    if (!GUID.test(clientId)) throw new ConnectorError("The Application (client) ID is a GUID, e.g. 1a2b3c4d-….");
    const clientSecret = (input.clientSecret ?? "").trim();
    if (clientSecret.length < 10 || /\s/.test(clientSecret)) throw new ConnectorError("Paste the full client secret value.");
    return { tenantId: normaliseTenant(input.tenantId ?? ""), environment: normaliseEnvironment(input.environment ?? ""), clientId, clientSecret, company: (input.company ?? "").trim().slice(0, 100) };
  },

  async test(creds, deps) {
    const s = await openSession(creds, deps);
    const c = await company(s);
    return { accountLabel: `${c.displayName || c.name} (${creds.environment})` };
  },

  async pull(creds, report, window, deps) {
    const spec = BC_REPORTS.find((r) => r.id === report);
    if (!spec) throw new ConnectorError(`Unknown Business Central report: ${report}`);
    const s = await openSession(creds, deps);
    const c = await company(s);
    const info = await getJson(s, `${apiRoot(creds)}/companies(${c.id})/companyInformation`);
    const ctx: Ctx = { lcy: str(info.value?.[0]?.currencyCode) };
    if (spec.needsShipments) ctx.shipments = await shipmentIndex(s, c.id, window);
    if (spec.needsRates) ctx.rates = await exchangeRates(s, c.id);

    const rows: string[][] = [];
    for await (const page of allPages(s, entityUrl(s, c.id, spec, window))) {
      for (const d of page) if (!spec.keep || spec.keep(d)) rows.push(...spec.rows(d, ctx));
      if (rows.length > MAX_ROWS) throw new ConnectorError("More than 200,000 rows in that period. Pull a shorter period.");
    }
    return { headers: [...spec.columns], rows };
  },

  purchaseInvoices: bcPurchaseInvoices,
  journals: bcJournals,
};
