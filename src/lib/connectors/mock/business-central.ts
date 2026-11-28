import { BC_API_HOST, BC_LOGIN_HOST, BC_SCOPE } from "../business-central";
import type { FetchLike } from "../types";
import { DEMO_COMPANIES, DEMO_COMPANY, DEMO_COMPANY_INFORMATION, DEMO_DATA } from "./business-central-data";
import { DEMO_STORE_COMPANY, DEMO_STORE_COMPANY_INFORMATION, DEMO_STORE_DATA } from "./business-central-store-data";

// An in-process stand-in for Microsoft Entra sign-in and the Business Central API v2.0
// (D-29). It answers the same URLs, with the same JSON shapes, for one invented tenant with a
// trading company, a web store company (D-52) and an empty holding company, so
// tests and local demos exercise the real connector code with no network and no real
// credentials. Supported: client-credentials token, companies, companyInformation, and
// document collections with `$filter=<date> ge X and <date> le Y` or `<field> eq '<text>'`
// (joined with `and`), `$expand=<lines>` and server-driven paging through @odata.nextLink.
// Writes (D-64): draft purchase invoices and their lines can be created, read back by id and
// deleted. Purchase order lines' quantity to invoice, quantity to receive and direct unit cost
// can be changed (D-88). Writes live in memory (`writes`) and never change the invented books themselves.

/** Made-up sign-in values for the demo tenant. They work only against this mock. */
export const DEMO_BC_CREDENTIALS = {
  tenantId: "sawwi-demo.onmicrosoft.com",
  environment: "Sandbox",
  clientId: "0b0c0de0-0000-4000-8000-000000000bc1",
  clientSecret: "demo-only-secret-not-real",
  company: "Sawwi Demo Trading LLC",
} as const;

/** The same tenant, signed in to the web store's company (D-52). */
export const DEMO_BC_STORE_CREDENTIALS = { ...DEMO_BC_CREDENTIALS, company: "Sawwi Demo Store LLC" } as const;

const COMPANIES = [...DEMO_COMPANIES, DEMO_STORE_COMPANY];
const BOOKS: Record<string, { info: unknown[]; data: Record<string, Record<string, unknown>[]> }> = {
  [DEMO_COMPANY.id]: { info: DEMO_COMPANY_INFORMATION, data: DEMO_DATA },
  [DEMO_STORE_COMPANY.id]: { info: DEMO_STORE_COMPANY_INFORMATION, data: DEMO_STORE_DATA },
};
const EMPTY = { info: [], data: {} };

const TOKEN = "mock-bc-access-token";
const LINES: Record<string, string> = {
  salesInvoices: "salesInvoiceLines",
  salesOrders: "salesOrderLines",
  salesShipments: "salesShipmentLines",
  purchaseOrders: "purchaseOrderLines",
  purchaseReceipts: "purchaseReceiptLines",
  purchaseInvoices: "purchaseInvoiceLines",
  salesCreditMemos: "salesCreditMemoLines",
};

const ENTITIES = new Set([...Object.keys(LINES), ...Object.keys(DEMO_STORE_DATA), "vendors", "accounts", "journals", "generalLedgerEntries", "customers", "customerPaymentJournals"]);
/** Batches and their line collections: general journals (D-71) and customer payment journals (D-75). */
const BATCHES: Record<string, string> = { journals: "journalLines", customerPaymentJournals: "customerPayments" };

type Reply = { status: number; body: unknown; headers?: Record<string, string> };
const reply = (r: Reply) => ({
  ok: r.status >= 200 && r.status < 300,
  status: r.status,
  headers: { get: (n: string) => r.headers?.[n] ?? null },
  json: async () => r.body,
});
const odataError = (status: number, code: string, message: string): Reply => ({ status, body: { error: { code, message } } });

export const isBusinessCentralUrl = (url: string) => url.startsWith(`${BC_LOGIN_HOST}/`) || url.startsWith(`${BC_API_HOST}/`);

export type MockBusinessCentralOptions = {
  /** Rows per page before a nextLink; small by default so paging is always exercised. */
  pageSize?: number;
  /** Requests seen, for assertions. */
  log?: { method: string; url: string; body?: string }[];
  /** Draft purchase invoices created through the mock, per company id. Pass one to share or inspect it. */
  writes?: Map<string, Record<string, unknown>[]>;
  /** Answer writes with 403, like an app with a read-only permission set. */
  readOnly?: boolean;
  /** Further companies in the same tenant, e.g. a local mock sandbox loaded from a file (D-94). */
  books?: MockBooks[];
};

/** One company's books for the mock: its record, companyInformation rows, and documents by API entity. */
export type MockBooks = { company: { id: string; name: string; displayName: string }; info: unknown[]; data: Record<string, Record<string, unknown>[]> };

type Doc = Record<string, unknown>;
const r2 = (n: number) => Math.round(n * 100) / 100;
let written = 0;
const newId = () => `d1a7f000-0000-4000-8000-${String(++written).padStart(12, "0")}`;

/** `a eq 'x' and b eq 'y'`, the only non-date filter the connector sends. */
function eqFilter(filter: string): [string, string][] | undefined {
  const parts = filter.split(" and ").map((p) => p.match(/^(\w+) eq '((?:[^']|'')*)'$/));
  return parts.every(Boolean) ? parts.map((m) => [m![1], m![2].replace(/''/g, "'")]) : undefined;
}

/** `a eq 'x' and d ge 2026-01-01 …`: equality on text and ge/le on dates, joined with `and`. */
function mixedFilter(filter: string): ((d: Doc) => boolean) | undefined {
  const parts = filter.split(" and ").map((p) => p.match(/^(\w+) (?:eq '((?:[^']|'')*)'|(ge|le) (\d{4}-\d{2}-\d{2}))$/));
  if (!parts.every(Boolean)) return undefined;
  return (d) =>
    parts.every((m) => {
      const v = String(d[m![1]] ?? "");
      if (m![2] !== undefined) return v === m![2].replace(/''/g, "'");
      return m![3] === "ge" ? v >= m![4] : v <= m![4];
    });
}

function totalsOf(lines: Doc[]) {
  const ex = r2(lines.reduce((a, l) => a + Number(l.netAmount ?? 0), 0));
  const tax = r2(lines.reduce((a, l) => a + Number(l.netTaxAmount ?? 0), 0));
  return { totalAmountExcludingTax: ex, totalTaxAmount: tax, totalAmountIncludingTax: r2(ex + tax) };
}

export function mockBusinessCentral(opts: MockBusinessCentralOptions = {}): FetchLike {
  const pageSize = opts.pageSize ?? 3;
  const companies = [...COMPANIES, ...(opts.books ?? []).map((b) => b.company)];
  const booksById: Record<string, { info: unknown[]; data: Record<string, Record<string, unknown>[]> }> = { ...BOOKS, ...Object.fromEntries((opts.books ?? []).map((b) => [b.company.id, b])) };
  const demo = DEMO_BC_CREDENTIALS;
  const writes = opts.writes ?? new Map<string, Doc[]>();

  return async (url, init) => {
    opts.log?.push({ method: init.method, url, body: init.body });

    // Microsoft Entra: client credentials.
    if (url.startsWith(`${BC_LOGIN_HOST}/`)) {
      const tenant = decodeURIComponent(url.slice(BC_LOGIN_HOST.length + 1).split("/")[0]);
      if (init.method !== "POST" || !url.endsWith("/oauth2/v2.0/token")) return reply({ status: 404, body: {} });
      if (tenant !== demo.tenantId) return reply({ status: 400, body: { error: "invalid_request", error_description: `AADSTS90002: Tenant '${tenant}' not found.` } });
      const form = new URLSearchParams(init.body ?? "");
      if (form.get("grant_type") !== "client_credentials" || form.get("scope") !== BC_SCOPE) return reply({ status: 400, body: { error: "invalid_request" } });
      if (form.get("client_id") !== demo.clientId) return reply({ status: 400, body: { error: "unauthorized_client", error_description: "AADSTS700016: Application not found in the directory." } });
      if (form.get("client_secret") !== demo.clientSecret) return reply({ status: 401, body: { error: "invalid_client", error_description: "AADSTS7000215: Invalid client secret provided." } });
      return reply({ status: 200, body: { token_type: "Bearer", expires_in: 3599, access_token: TOKEN } });
    }

    // Business Central API v2.0.
    if (!["GET", "POST", "PATCH", "DELETE"].includes(init.method)) return reply(odataError(405, "BadRequest_MethodNotAllowed", "Method not allowed."));
    if (init.headers.Authorization !== `Bearer ${TOKEN}`) return reply(odataError(401, "Authentication_InvalidCredentials", "The credentials provided are incorrect."));
    const u = new URL(url);
    const m = u.pathname.match(/^\/v2\.0\/([^/]+)\/([^/]+)\/api\/v2\.0\/(.*)$/);
    if (!m) return reply(odataError(404, "BadRequest_NotFound", "No HTTP resource was found."));
    const [, tenant, environment, rest] = m.map(decodeURIComponent);
    if (tenant !== demo.tenantId || environment !== demo.environment) return reply(odataError(404, "BadRequest_NotFound", "Environment not found."));
    if (rest === "companies") return reply({ status: 200, body: { value: companies } });

    const cm = rest.match(/^companies\(([^)]+)\)\/(\w+)(?:\(([^)]+)\)(?:\/(\w+)(?:\(([^)]+)\))?)?)?$/);
    if (!cm) return reply(odataError(404, "BadRequest_NotFound", "No HTTP resource was found."));
    const [, companyId, entity, docId, sub, subId] = cm;
    if (!companies.some((c) => c.id === companyId)) return reply(odataError(404, "Internal_CompanyNotFound", "Company not found."));
    const books = booksById[companyId] ?? EMPTY;
    const drafts = writes.get(companyId) ?? [];
    writes.set(companyId, drafts);

    // General journal lines (D-71): list, filter by document number, add and delete; unposted, in memory.
    if (BATCHES[entity] && docId) {
      const batch = (books.data[entity] ?? []).find((j) => j.id === docId);
      if (!batch || sub !== BATCHES[entity]) return reply(odataError(404, "BadRequest_NotFound", "The journal does not exist."));
      const key = `${companyId}/${entity}/${docId}`;
      const lines = writes.get(key) ?? [];
      writes.set(key, lines);
      if (init.method !== "GET" && opts.readOnly) return reply(odataError(403, "Authorization_InsufficientPermissions", "You do not have the following permissions on TableData Gen. Journal Line: Insert."));
      if (init.method === "GET" && !subId) {
        const filter = u.searchParams.get("$filter");
        const eq = filter ? eqFilter(filter) : [];
        if (!eq) return reply(odataError(400, "BadRequest", `Unsupported filter in the mock: ${filter}`));
        return reply({ status: 200, body: { value: lines.filter((l) => eq.every(([k, v]) => String(l[k] ?? "") === v)) } });
      }
      if (init.method === "DELETE" && subId) {
        const i = lines.findIndex((l) => l.id === subId);
        if (i < 0) return reply(odataError(404, "BadRequest_NotFound", "The journal line does not exist."));
        lines.splice(i, 1);
        return reply({ status: 204, body: {} });
      }
      if (init.method === "POST" && !subId) {
        let body: Doc;
        try {
          body = JSON.parse(init.body ?? "{}") as Doc;
        } catch {
          return reply(odataError(400, "BadRequest", "Invalid JSON."));
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.postingDate))) return reply(odataError(400, "BadRequest", "Posting Date must have a value."));
        let extra: Doc;
        if (entity === "journals") {
          const account = (books.data.accounts ?? []).find((a) => a.number === body.accountNumber);
          if (body.accountType !== "G/L Account" || !account) return reply(odataError(400, "Internal_RecordNotFound", `The G/L Account does not exist. Identification fields and values: No.='${String(body.accountNumber)}'`));
          extra = { accountId: account.id };
        } else {
          const customer = (books.data.customers ?? []).find((c) => c.number === body.customerNumber);
          if (!customer) return reply(odataError(400, "Internal_RecordNotFound", `The Customer does not exist. Identification fields and values: No.='${String(body.customerNumber)}'`));
          if (body.appliesToInvoiceNumber) {
            const inv = (books.data.salesInvoices ?? []).find((d) => d.number === body.appliesToInvoiceNumber);
            if (!inv || inv.status !== "Open") return reply(odataError(400, "Application_NotOpen", `Invoice ${String(body.appliesToInvoiceNumber)} isn't open for application.`));
            if (inv.customerNumber !== body.customerNumber) return reply(odataError(400, "Application_WrongCustomer", `Invoice ${String(body.appliesToInvoiceNumber)} belongs to another customer.`));
          }
          extra = { customerId: customer.id };
        }
        const line = { id: newId(), journalId: docId, lineNumber: (lines.length + 1) * 10000, ...body, ...extra };
        lines.push(line);
        return reply({ status: 201, body: line });
      }
      return reply(odataError(405, "BadRequest_MethodNotAllowed", "Not supported by the mock."));
    }

    // Purchase order lines (D-88): read an order's lines, and change what to receive and invoice.
    const poOverlay = writes.get(`${companyId}/purchaseOrderLines`) ?? [];
    writes.set(`${companyId}/purchaseOrderLines`, poOverlay);
    const withOverlay = (l: Doc) => ({ ...l, ...(poOverlay.find((o) => o.id === l.id) ?? {}) });
    if (entity === "purchaseOrders" && docId) {
      const order = (books.data.purchaseOrders ?? []).find((o) => o.id === docId);
      if (!order) return reply(odataError(404, "BadRequest_NotFound", "The purchase order does not exist."));
      const orderLines = ((order.purchaseOrderLines as Doc[]) ?? []).map(withOverlay);
      if (!sub && init.method === "GET") return reply({ status: 200, body: Object.fromEntries(Object.entries(order).filter(([k]) => k !== "purchaseOrderLines")) });
      if (sub !== "purchaseOrderLines") return reply(odataError(404, "BadRequest_NotFound", "No HTTP resource was found."));
      if (init.method === "GET" && !subId) return reply({ status: 200, body: { value: orderLines } });
      if (init.method === "PATCH" && subId) {
        if (opts.readOnly) return reply(odataError(403, "Authorization_InsufficientPermissions", "You do not have the following permissions on TableData Purchase Line: Modify."));
        if (init.headers["If-Match"] === undefined) return reply(odataError(400, "BadRequest", "If-Match header is required."));
        const line = orderLines.find((l) => l.id === subId);
        if (!line) return reply(odataError(404, "BadRequest_NotFound", "The purchase order line does not exist."));
        let body: Doc;
        try {
          body = JSON.parse(init.body ?? "{}") as Doc;
        } catch {
          return reply(odataError(400, "BadRequest", "Invalid JSON."));
        }
        const patch = Object.fromEntries(Object.entries(body).filter(([k]) => ["invoiceQuantity", "receiveQuantity", "directUnitCost"].includes(k)));
        if (Object.keys(patch).length !== Object.keys(body).length) return reply(odataError(400, "BadRequest", "The mock only changes invoiceQuantity, receiveQuantity and directUnitCost."));
        const next = { ...line, ...patch };
        const open = Number(next.receivedQuantity ?? 0) - Number(next.invoicedQuantity ?? 0) + Number(next.receiveQuantity ?? 0);
        if (Number(next.invoiceQuantity ?? 0) > open + 1e-9) return reply(odataError(400, "Application_FieldValidationException", `Qty. to Invoice cannot be more than ${open}.`));
        const i = poOverlay.findIndex((o) => o.id === subId);
        const merged = { ...(i >= 0 ? poOverlay[i] : { id: subId }), ...patch };
        if (i >= 0) poOverlay[i] = merged;
        else poOverlay.push(merged);
        return reply({ status: 200, body: withOverlay(line) });
      }
      return reply(odataError(405, "BadRequest_MethodNotAllowed", "Not supported by the mock."));
    }

    // Writes: draft purchase invoices only (D-64).
    if (init.method !== "GET" || docId) {
      if (entity !== "purchaseInvoices") return reply(odataError(405, "BadRequest_MethodNotAllowed", "The mock only writes purchase invoices."));
      if (init.method !== "GET" && opts.readOnly) return reply(odataError(403, "Authorization_InsufficientPermissions", "You do not have the following permissions on TableData Purchase Header: Insert."));
      const found = docId ? drafts.find((d) => d.id === docId) : undefined;
      if (docId && !found) return reply(odataError(404, "BadRequest_NotFound", "The purchase invoice does not exist."));
      const body = (() => { try { return JSON.parse(init.body ?? "{}") as Doc; } catch { return undefined; } })();
      if (init.method !== "GET" && init.method !== "DELETE" && !body) return reply(odataError(400, "BadRequest", "Invalid JSON."));

      if (init.method === "GET" && found && !sub) return reply({ status: 200, body: Object.fromEntries(Object.entries(found).filter(([k]) => k !== "purchaseInvoiceLines")) });
      if (init.method === "DELETE" && found && !sub) {
        if (init.headers["If-Match"] === undefined) return reply(odataError(400, "BadRequest", "If-Match header is required."));
        drafts.splice(drafts.indexOf(found), 1);
        return reply({ status: 204, body: {} });
      }
      if (init.method === "POST" && !docId) {
        const vendor = (books.data.vendors ?? []).find((v) => v.number === body!.vendorNumber);
        if (!vendor) return reply(odataError(400, "Internal_RecordNotFound", `The Vendor does not exist. Identification fields and values: No.='${String(body!.vendorNumber)}'`));
        const allPi = [...(books.data.purchaseInvoices ?? []), ...drafts];
        const doc: Doc = {
          id: newId(), number: `PI-${1000 + allPi.length + written}`, vendorNumber: vendor.number, vendorName: vendor.displayName, vendorInvoiceNumber: String(body!.vendorInvoiceNumber ?? ""),
          invoiceDate: body!.invoiceDate, postingDate: body!.invoiceDate, dueDate: body!.dueDate ?? body!.invoiceDate, currencyCode: body!.currencyCode ?? "", orderNumber: "", status: "Draft",
          ...totalsOf([]), purchaseInvoiceLines: [],
        };
        drafts.push(doc);
        return reply({ status: 201, body: Object.fromEntries(Object.entries(doc).filter(([k]) => k !== "purchaseInvoiceLines")) });
      }
      if (init.method === "POST" && found && sub === "purchaseInvoiceLines") {
        const lines = found.purchaseInvoiceLines as Doc[];
        const type = String(body!.lineType);
        const no = String(body!.lineObjectNumber ?? "");
        const master = type === "Item" ? books.data.items : type === "Account" ? books.data.accounts : undefined;
        const record = master?.find((r) => r.number === no);
        if (!record) return reply(odataError(400, "Internal_RecordNotFound", `The ${type === "Account" ? "G/L Account" : type} does not exist. Identification fields and values: No.='${no}'`));
        const qty = Number(body!.quantity ?? 0);
        const cost = Number(body!.directUnitCost ?? 0);
        // The company's VAT rate: 5% for the invented UAE companies, set per sandbox otherwise (D-94).
        const vatPct = Number((books.info[0] as Doc | undefined)?.mockVatPercent ?? 5);
        const net = r2(qty * cost);
        const line = {
          id: newId(), sequence: (lines.length + 1) * 10000, lineType: type, lineObjectNumber: no, description: body!.description ?? record.displayName, quantity: qty, directUnitCost: cost,
          taxPercent: vatPct, netAmount: net, netTaxAmount: r2((net * vatPct) / 100), netAmountIncludingTax: r2(net + (net * vatPct) / 100),
        };
        lines.push(line);
        Object.assign(found, totalsOf(lines));
        return reply({ status: 201, body: line });
      }
      return reply(odataError(405, "BadRequest_MethodNotAllowed", "Not supported by the mock."));
    }
    if (entity === "companyInformation") return reply({ status: 200, body: { value: books.info } });
    if (!ENTITIES.has(entity)) return reply(odataError(404, "BadRequest_NotFound", `Resource '${entity}' not found.`));

    let rows = [...(books.data[entity] ?? []), ...(entity === "purchaseInvoices" ? drafts : [])];
    const filter = u.searchParams.get("$filter");
    if (filter) {
      const f = filter.match(/^(\w+) ge (\d{4}-\d{2}-\d{2}) and (\w+) le (\d{4}-\d{2}-\d{2})$/);
      const eq = f ? undefined : eqFilter(filter);
      const mixed = f || eq ? undefined : mixedFilter(filter);
      if ((!f || f[1] !== f[3]) && !eq && !mixed) return reply(odataError(400, "BadRequest", `Unsupported filter in the mock: ${filter}`));
      rows = f ? rows.filter((d) => String(d[f[1]]) >= f[2] && String(d[f[1]]) <= f[4]) : eq ? rows.filter((d) => eq.every(([k, v]) => String(d[k] ?? "") === v)) : rows.filter(mixed!);
    }
    const expand = u.searchParams.get("$expand");
    if (expand && expand !== LINES[entity]) return reply(odataError(400, "BadRequest", `Could not find a property named '${expand}'.`));
    if (entity === "purchaseOrders") rows = rows.map((d) => ({ ...d, purchaseOrderLines: ((d.purchaseOrderLines as Doc[]) ?? []).map(withOverlay) }));
    const shaped = rows.map((d) => (expand ? d : Object.fromEntries(Object.entries(d).filter(([k]) => k !== LINES[entity]))));

    const skip = Number(u.searchParams.get("$skiptoken") ?? 0);
    const page = shaped.slice(skip, skip + pageSize);
    const body: Record<string, unknown> = { "@odata.context": `${BC_API_HOST}/v2.0/$metadata#companies(${companyId})/${entity}`, value: page };
    if (skip + pageSize < shaped.length) {
      const next = new URL(url);
      next.searchParams.set("$skiptoken", String(skip + pageSize));
      body["@odata.nextLink"] = next.toString();
    }
    return reply({ status: 200, body });
  };
}
