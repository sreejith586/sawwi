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
// deleted. They live in memory (`writes`) and never change the invented books themselves.

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

const ENTITIES = new Set([...Object.keys(LINES), ...Object.keys(DEMO_STORE_DATA), "vendors", "accounts"]);

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
};

type Doc = Record<string, unknown>;
const r2 = (n: number) => Math.round(n * 100) / 100;
let written = 0;
const newId = () => `d1a7f000-0000-4000-8000-${String(++written).padStart(12, "0")}`;

/** `a eq 'x' and b eq 'y'`, the only non-date filter the connector sends. */
function eqFilter(filter: string): [string, string][] | undefined {
  const parts = filter.split(" and ").map((p) => p.match(/^(\w+) eq '((?:[^']|'')*)'$/));
  return parts.every(Boolean) ? parts.map((m) => [m![1], m![2].replace(/''/g, "'")]) : undefined;
}

function totalsOf(lines: Doc[]) {
  const ex = r2(lines.reduce((a, l) => a + Number(l.netAmount ?? 0), 0));
  const tax = r2(lines.reduce((a, l) => a + Number(l.netTaxAmount ?? 0), 0));
  return { totalAmountExcludingTax: ex, totalTaxAmount: tax, totalAmountIncludingTax: r2(ex + tax) };
}

export function mockBusinessCentral(opts: MockBusinessCentralOptions = {}): FetchLike {
  const pageSize = opts.pageSize ?? 3;
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
    if (!["GET", "POST", "DELETE"].includes(init.method)) return reply(odataError(405, "BadRequest_MethodNotAllowed", "Method not allowed."));
    if (init.headers.Authorization !== `Bearer ${TOKEN}`) return reply(odataError(401, "Authentication_InvalidCredentials", "The credentials provided are incorrect."));
    const u = new URL(url);
    const m = u.pathname.match(/^\/v2\.0\/([^/]+)\/([^/]+)\/api\/v2\.0\/(.*)$/);
    if (!m) return reply(odataError(404, "BadRequest_NotFound", "No HTTP resource was found."));
    const [, tenant, environment, rest] = m.map(decodeURIComponent);
    if (tenant !== demo.tenantId || environment !== demo.environment) return reply(odataError(404, "BadRequest_NotFound", "Environment not found."));
    if (rest === "companies") return reply({ status: 200, body: { value: COMPANIES } });

    const cm = rest.match(/^companies\(([^)]+)\)\/(\w+)(?:\(([^)]+)\)(?:\/(\w+))?)?$/);
    if (!cm) return reply(odataError(404, "BadRequest_NotFound", "No HTTP resource was found."));
    const [, companyId, entity, docId, sub] = cm;
    if (!COMPANIES.some((c) => c.id === companyId)) return reply(odataError(404, "Internal_CompanyNotFound", "Company not found."));
    const books = BOOKS[companyId] ?? EMPTY;
    const drafts = writes.get(companyId) ?? [];
    writes.set(companyId, drafts);

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
        const net = r2(qty * cost);
        const line = {
          id: newId(), sequence: (lines.length + 1) * 10000, lineType: type, lineObjectNumber: no, description: body!.description ?? record.displayName, quantity: qty, directUnitCost: cost,
          taxPercent: 5, netAmount: net, netTaxAmount: r2(net * 0.05), netAmountIncludingTax: r2(net * 1.05),
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
      if ((!f || f[1] !== f[3]) && !eq) return reply(odataError(400, "BadRequest", `Unsupported filter in the mock: ${filter}`));
      rows = f ? rows.filter((d) => String(d[f[1]]) >= f[2] && String(d[f[1]]) <= f[4]) : rows.filter((d) => eq!.every(([k, v]) => String(d[k] ?? "") === v));
    }
    const expand = u.searchParams.get("$expand");
    if (expand && expand !== LINES[entity]) return reply(odataError(400, "BadRequest", `Could not find a property named '${expand}'.`));
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
