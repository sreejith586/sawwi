import type { FetchLike } from "../types";
import { DEMO_CREDIT_MEMOS, DEMO_ORDERS, DEMO_SHIPMENTS, DEMO_STORE_CONFIGS } from "./magento-data";

// An in-process stand-in for a Magento 2 store's REST API (D-30), for one invented store at a
// reserved .example address. It answers the same paths and JSON shapes for GET orders,
// creditmemos, shipments (searchCriteria filters, `in`, paging that repeats the last page past
// the end, as Magento does) and store/storeConfigs, so tests and local demos run the real
// connector with no network and no real token.

/** Made-up values for the demo store. They work only against this mock. */
export const DEMO_MAGENTO_CREDENTIALS = {
  baseUrl: "https://demo-store.sawwi-mock.example",
  accessToken: "demo-only-magento-token-not-real",
} as const;

const ROOT = `${DEMO_MAGENTO_CREDENTIALS.baseUrl}/rest/V1/`;
export const isMagentoMockUrl = (url: string) => url.startsWith(`${DEMO_MAGENTO_CREDENTIALS.baseUrl}/`);

type Doc = Record<string, unknown>;
type Reply = { status: number; body: unknown };
const reply = (r: Reply) => ({ ok: r.status >= 200 && r.status < 300, status: r.status, headers: { get: () => null }, json: async () => r.body });
const denied = (resource: string): Reply => ({ status: 401, body: { message: "The consumer isn't authorized to access %resources.", parameters: { resources: resource } } });

const COLLECTIONS: Record<string, { rows: Doc[]; resource: string }> = {
  orders: { rows: DEMO_ORDERS, resource: "Magento_Sales::actions_view" },
  creditmemos: { rows: DEMO_CREDIT_MEMOS, resource: "Magento_Sales::sales_creditmemo" },
  shipments: { rows: DEMO_SHIPMENTS, resource: "Magento_Sales::shipment" },
};

type Filter = { field: string; value: string; condition: string };

function matches(d: Doc, f: Filter): boolean {
  const v = String(d[f.field] ?? "");
  switch (f.condition) {
    case "eq":
      return v === f.value;
    case "in":
      return f.value.split(",").includes(v);
    case "gteq":
      return v >= f.value;
    case "lteq":
      return v <= f.value;
    default:
      throw new Error(`The mock doesn't support condition_type=${f.condition}`);
  }
}

export type MockMagentoOptions = {
  log?: { method: string; url: string }[];
  /** Resources the integration lacks, e.g. "Magento_Sales::shipment", to test permission errors. */
  deny?: string[];
  /** Serve at most this many items a page, whatever the client asks, to exercise paging. */
  maxPageSize?: number;
};

export function mockMagento(opts: MockMagentoOptions = {}): FetchLike {
  return async (url, init) => {
    opts.log?.push({ method: init.method, url });
    if (!url.startsWith(ROOT)) return reply({ status: 404, body: { message: "Request does not match any route." } });
    if (init.method !== "GET") return reply({ status: 405, body: { message: "Sawwi's mock is read-only." } });
    if (init.headers.Authorization !== `Bearer ${DEMO_MAGENTO_CREDENTIALS.accessToken}`) return reply(denied("Magento_Sales::actions_view"));

    const u = new URL(url);
    const path = u.pathname.slice(new URL(ROOT).pathname.length);
    if (path === "store/storeConfigs") return reply(opts.deny?.includes("Magento_Backend::store") ? denied("Magento_Backend::store") : { status: 200, body: DEMO_STORE_CONFIGS });
    const collection = COLLECTIONS[path];
    if (!collection) return reply({ status: 404, body: { message: "Request does not match any route." } });
    if (opts.deny?.includes(collection.resource)) return reply(denied(collection.resource));

    // searchCriteria[filter_groups][g][filters][i][field|value|condition_type]
    const groups = new Map<number, Map<number, Partial<Filter>>>();
    for (const [k, v] of u.searchParams) {
      const m = k.match(/^searchCriteria\[filter_groups\]\[(\d+)\]\[filters\]\[(\d+)\]\[(field|value|condition_type)\]$/);
      if (!m) continue;
      const g = groups.get(+m[1]) ?? new Map<number, Partial<Filter>>();
      const f = g.get(+m[2]) ?? {};
      f[m[3] === "condition_type" ? "condition" : (m[3] as "field" | "value")] = v;
      g.set(+m[2], f);
      groups.set(+m[1], g);
    }
    const filtered = collection.rows.filter((d) => [...groups.values()].every((g) => [...g.values()].some((f) => matches(d, { condition: "eq", ...f } as Filter))));
    const asked = Number(u.searchParams.get("searchCriteria[pageSize]") ?? filtered.length) || filtered.length || 1;
    const size = Math.min(asked, opts.maxPageSize ?? asked);
    const lastPage = Math.max(1, Math.ceil(filtered.length / size));
    const current = Math.min(Number(u.searchParams.get("searchCriteria[currentPage]") ?? 1), lastPage); // Magento repeats the last page
    const items = filtered.slice((current - 1) * size, current * size);
    return reply({ status: 200, body: { items, search_criteria: {}, total_count: filtered.length } });
  };
}
