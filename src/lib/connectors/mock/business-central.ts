import { BC_API_HOST, BC_LOGIN_HOST, BC_SCOPE } from "../business-central";
import type { FetchLike } from "../types";
import { DEMO_COMPANIES, DEMO_COMPANY_INFORMATION, DEMO_DATA } from "./business-central-data";

// An in-process stand-in for Microsoft Entra sign-in and the Business Central API v2.0
// (D-29). It answers the same URLs, with the same JSON shapes, for one invented tenant, so
// tests and local demos exercise the real connector code with no network and no real
// credentials. Supported: client-credentials token, companies, companyInformation, and
// document collections with `$filter=<date> ge X and <date> le Y`, `$expand=<lines>` and
// server-driven paging through @odata.nextLink.

/** Made-up sign-in values for the demo tenant. They work only against this mock. */
export const DEMO_BC_CREDENTIALS = {
  tenantId: "sawwi-demo.onmicrosoft.com",
  environment: "Sandbox",
  clientId: "0b0c0de0-0000-4000-8000-000000000bc1",
  clientSecret: "demo-only-secret-not-real",
  company: "Sawwi Demo Trading LLC",
} as const;

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
  log?: { method: string; url: string }[];
};

export function mockBusinessCentral(opts: MockBusinessCentralOptions = {}): FetchLike {
  const pageSize = opts.pageSize ?? 3;
  const demo = DEMO_BC_CREDENTIALS;

  return async (url, init) => {
    opts.log?.push({ method: init.method, url });

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
    if (init.method !== "GET") return reply(odataError(405, "BadRequest_MethodNotAllowed", "Sawwi's mock is read-only."));
    if (init.headers.Authorization !== `Bearer ${TOKEN}`) return reply(odataError(401, "Authentication_InvalidCredentials", "The credentials provided are incorrect."));
    const u = new URL(url);
    const m = u.pathname.match(/^\/v2\.0\/([^/]+)\/([^/]+)\/api\/v2\.0\/(.*)$/);
    if (!m) return reply(odataError(404, "BadRequest_NotFound", "No HTTP resource was found."));
    const [, tenant, environment, rest] = m.map(decodeURIComponent);
    if (tenant !== demo.tenantId || environment !== demo.environment) return reply(odataError(404, "BadRequest_NotFound", "Environment not found."));
    if (rest === "companies") return reply({ status: 200, body: { value: DEMO_COMPANIES } });

    const cm = rest.match(/^companies\(([^)]+)\)\/(\w+)$/);
    if (!cm) return reply(odataError(404, "BadRequest_NotFound", "No HTTP resource was found."));
    const [, companyId, entity] = cm;
    if (!DEMO_COMPANIES.some((c) => c.id === companyId)) return reply(odataError(404, "Internal_CompanyNotFound", "Company not found."));
    const isDemo = companyId === DEMO_COMPANIES[0].id;
    if (entity === "companyInformation") return reply({ status: 200, body: { value: isDemo ? DEMO_COMPANY_INFORMATION : [] } });
    const all = DEMO_DATA[entity];
    if (!all) return reply(odataError(404, "BadRequest_NotFound", `Resource '${entity}' not found.`));

    let rows = isDemo ? all : [];
    const filter = u.searchParams.get("$filter");
    if (filter) {
      const f = filter.match(/^(\w+) ge (\d{4}-\d{2}-\d{2}) and (\w+) le (\d{4}-\d{2}-\d{2})$/);
      if (!f || f[1] !== f[3]) return reply(odataError(400, "BadRequest", `Unsupported filter in the mock: ${filter}`));
      rows = rows.filter((d) => String(d[f[1]]) >= f[2] && String(d[f[1]]) <= f[4]);
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
