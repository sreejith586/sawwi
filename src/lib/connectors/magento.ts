import { num, str } from "./format";
import { isPublicHostname } from "./net-guard";
import { ConnectorError, type Connector, type ConnectorDeps, type PullWindow } from "./types";

// Magento 2 / Adobe Commerce, REST API (D-30). Auth: an integration access token. The
// merchant creates an integration in their admin (System → Extensions → Integrations) with
// read-only resources (Sales → Operations: Orders, Invoices, Credit Memos, Shipments, and
// Stores → Settings for the weight unit), activates it and copies the Access Token. Since
// Magento 2.4.4 that token is accepted as a Bearer token only when
// Stores → Configuration → Services → OAuth → Consumer Settings → "Allow OAuth Access Tokens
// to be used as standalone Bearer tokens" is Yes. Sawwi only sends GETs.
//
// The store lives on its own domain, so the URL is checked here (https, public host name) and
// every live request is checked again when it is sent (public addresses only, no redirects).
//
// Docs: https://developer.adobe.com/commerce/webapi/rest/use-rest/performing-searches/
//       https://developer.adobe.com/commerce/webapi/get-started/authentication/gs-authentication-token/

const PAGE_SIZE = 100;
const MAX_ROWS = 200_000;
const MAX_ATTEMPTS = 5;

export type MagentoCredentials = { baseUrl: string; accessToken: string };
type Doc = Record<string, unknown>;
type SearchResult = { items?: Doc[]; total_count?: number };

export function normaliseBaseUrl(input: string): string {
  let raw = input.trim();
  if (!/^[a-z]+:\/\//i.test(raw)) raw = `https://${raw}`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ConnectorError("Enter your store's address, e.g. https://shop.example.com.");
  }
  if (u.protocol !== "https:") throw new ConnectorError("The store address must start with https://.");
  if (u.username || u.password || u.search || u.hash || u.port) throw new ConnectorError("Enter just the store's address, without a port, login, query or #.");
  if (!isPublicHostname(u.hostname)) throw new ConnectorError("Enter the store's public web address, not an IP address or an internal name.");
  // People paste the admin or API URL; keep only the part before /rest, /admin or /index.php.
  const path = u.pathname.replace(/\/(rest|admin|index\.php)(\/.*)?$/i, "").replace(/\/+$/, "");
  return `https://${u.hostname.toLowerCase()}${path}`;
}

/** Magento searchCriteria query string. Filters in one group are OR'ed, groups are AND'ed. */
export function searchQuery(groups: { field: string; value: string; condition: string }[][], page?: { size: number; current: number }, fields?: string): string {
  const p = new URLSearchParams();
  groups.forEach((filters, g) =>
    filters.forEach((f, i) => {
      const k = `searchCriteria[filter_groups][${g}][filters][${i}]`;
      p.set(`${k}[field]`, f.field);
      p.set(`${k}[value]`, f.value);
      p.set(`${k}[condition_type]`, f.condition);
    }),
  );
  if (page) {
    p.set("searchCriteria[pageSize]", String(page.size));
    p.set("searchCriteria[currentPage]", String(page.current));
    p.set("searchCriteria[sortOrders][0][field]", "entity_id");
    p.set("searchCriteria[sortOrders][0][direction]", "ASC");
  }
  if (fields) p.set("fields", fields);
  return p.toString();
}

/** Magento stores times in UTC as "YYYY-MM-DD HH:MM:SS". Whole days, both ends inclusive. */
export const windowGroups = (w: PullWindow) => [
  [{ field: "created_at", value: `${w.from} 00:00:00`, condition: "gteq" }],
  [{ field: "created_at", value: `${w.to} 23:59:59`, condition: "lteq" }],
];

const isoTime = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? `${v.replace(" ", "T")}Z` : str(v));

async function get<T>(creds: MagentoCredentials, path: string, deps: ConnectorDeps): Promise<T> {
  const url = `${creds.baseUrl}/rest/V1/${path}`;
  for (let attempt = 1; ; attempt++) {
    const res = await deps.fetch(url, { method: "GET", headers: { Authorization: `Bearer ${creds.accessToken}`, Accept: "application/json" } });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= MAX_ATTEMPTS) throw new ConnectorError(`The store is busy (HTTP ${res.status}). Try again in a minute.`);
      const after = Number(res.headers.get("Retry-After"));
      await deps.sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * attempt);
      continue;
    }
    const body = (await res.json().catch(() => undefined)) as (T & { message?: string; parameters?: Record<string, string> | string[] }) | undefined;
    if (res.status === 401 || res.status === 403) {
      // Magento answers 401 both for a bad token and for a missing permission, naming the resource.
      const params = body?.parameters as Record<string, string> | undefined;
      const resource = params && !Array.isArray(params) ? params.resources : undefined;
      throw new ConnectorError(
        `The store refused access${resource ? ` (${resource})` : ""}. Check the access token, that the integration is active with read access to Sales → Operations (Orders, Invoices, Credit Memos, Shipments), and on Magento 2.4.4+ that “Allow OAuth Access Tokens to be used as standalone Bearer tokens” is Yes (Stores → Configuration → Services → OAuth).`,
      );
    }
    if (res.status === 404) throw new ConnectorError("No Magento REST API answered at that address. Check the store URL.");
    if (!res.ok || body === undefined) throw new ConnectorError(`The store returned HTTP ${res.status}${body?.message ? `: ${body.message}` : ""}.`);
    return body;
  }
}

/** Every page of a search, stopping at total_count (Magento repeats the last page past the end). */
async function search(creds: MagentoCredentials, resource: string, w: PullWindow, deps: ConnectorDeps): Promise<Doc[]> {
  const out: Doc[] = [];
  for (let page = 1; ; page++) {
    const r = await get<SearchResult>(creds, `${resource}?${searchQuery(windowGroups(w), { size: PAGE_SIZE, current: page })}`, deps);
    const items = r.items ?? [];
    out.push(...items);
    if (out.length > MAX_ROWS) throw new ConnectorError("More than 200,000 records in that period. Pull a shorter period.");
    if (items.length === 0 || out.length >= (r.total_count ?? 0)) return out;
  }
}

type OrderInfo = { number: string; email: string; name: string };

/** Invoices, credit memos and shipments only carry the order's internal ID; look up its number and customer. */
async function orderInfo(creds: MagentoCredentials, ids: number[], deps: ConnectorDeps): Promise<Map<number, OrderInfo>> {
  const map = new Map<number, OrderInfo>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += PAGE_SIZE) {
    const chunk = unique.slice(i, i + PAGE_SIZE);
    const q = searchQuery([[{ field: "entity_id", value: chunk.join(","), condition: "in" }]], { size: PAGE_SIZE, current: 1 }, "items[entity_id,increment_id,customer_email,customer_firstname,customer_lastname],total_count");
    const r = await get<SearchResult>(creds, `orders?${q}`, deps);
    for (const o of r.items ?? []) {
      map.set(Number(o.entity_id), { number: str(o.increment_id), email: str(o.customer_email), name: [str(o.customer_firstname), str(o.customer_lastname)].filter(Boolean).join(" ") });
    }
  }
  return map;
}

const NO_ORDER: OrderInfo = { number: "", email: "", name: "" };

/** "kgs" or "lbs" from the default store view; undefined if the integration can't read it. */
async function weightUnit(creds: MagentoCredentials, deps: ConnectorDeps): Promise<string | undefined> {
  try {
    const configs = await get<Doc[]>(creds, "store/storeConfigs", deps);
    return str((configs.find((c) => c.code === "default") ?? configs[0])?.weight_unit) || undefined;
  } catch (error) {
    if (error instanceof ConnectorError && /refused access/.test(error.message)) return undefined;
    throw error;
  }
}

export const MAGENTO_ORDER_COLUMNS = ["Order ID", "Order date", "Order status", "Payment method", "Payment method title", "Order total", "Refunded amount", "Shipping charged", "Currency", "Subtotal", "Discount", "Tax", "Total paid", "Store"] as const;
export const MAGENTO_REFUND_COLUMNS = ["Order ID", "Refund / credit memo ID", "Refund date", "SKU", "Product", "Quantity", "Refund amount", "Credit memo total", "Currency"] as const;
export const MAGENTO_INVOICE_COLUMNS = ["Order ID", "Store invoice no.", "Invoice date", "Customer e-mail", "Customer", "Subtotal", "Shipping", "Discount", "VAT amount", "Invoice total (incl. VAT)", "Currency"] as const;
export const MAGENTO_SHIPMENT_COLUMNS = ["AWB / tracking number", "Order ID", "Shipment ID", "Ship date", "Carrier", "Declared weight (kg)", "Store weight unit", "Items shipped"] as const;

type Report = { id: string; label: string; description: string; slots: string[]; columns: readonly string[] };
const REPORTS: Report[] = [
  { id: "orders", label: "Orders", description: "One row per order placed in the period: status, payment method, totals and refunds.", slots: ["orders"], columns: MAGENTO_ORDER_COLUMNS },
  { id: "credit_memo_lines", label: "Credit memo lines (refunds)", description: "Refunded items from credit memos created in the period, with the order they belong to.", slots: ["refunds"], columns: MAGENTO_REFUND_COLUMNS },
  {
    id: "invoices",
    label: "Invoices",
    description: "One row per invoice created in the period, with its order, customer e-mail, VAT and total.",
    slots: ["web-erp-invoices/store_invoices"],
    columns: MAGENTO_INVOICE_COLUMNS,
  },
  { id: "shipment_tracks", label: "Shipments (tracking numbers)", description: "One row per tracking number on shipments created in the period, with the order and weight.", slots: ["shipments"], columns: MAGENTO_SHIPMENT_COLUMNS },
];

export function orderRow(o: Doc): string[] {
  const payment = (o.payment ?? {}) as { method?: string; additional_information?: unknown[] };
  return [
    str(o.increment_id), isoTime(o.created_at), str(o.status), str(payment.method), str(payment.additional_information?.[0]),
    num(o.grand_total), num(o.total_refunded ?? 0), num(o.shipping_amount ?? 0), str(o.order_currency_code), num(o.subtotal), num(o.discount_amount ?? 0), num(o.tax_amount ?? 0), num(o.total_paid ?? 0),
    str(o.store_name).split("\n").pop() ?? "",
  ];
}

export function invoiceRow(inv: Doc, order: OrderInfo): string[] {
  return [
    order.number, str(inv.increment_id), isoTime(inv.created_at), order.email, order.name,
    num(inv.subtotal ?? 0), num(inv.shipping_amount ?? 0), num(inv.discount_amount ?? 0), num(inv.tax_amount ?? 0), num(inv.grand_total), str(inv.order_currency_code),
  ];
}

/** Refunded items; configurable parents and their zero-priced children are collapsed to one line. */
export function creditMemoRows(m: Doc, orderNo: string): string[][] {
  const items = ((m.items as Doc[] | undefined) ?? []).filter((i) => Number(i.qty) > 0 && !(Number(i.row_total ?? 0) === 0 && Number(i.price ?? 0) === 0));
  return items.map((i) => [
    orderNo, str(m.increment_id), isoTime(m.created_at), str(i.sku), str(i.name), num(i.qty),
    num(Number(i.row_total ?? 0) + Number(i.tax_amount ?? 0) - Number(i.discount_amount ?? 0)), num(m.grand_total), str(m.order_currency_code),
  ]);
}

const LBS_TO_KG = 0.45359237;
export function shipmentRows(s: Doc, orderNo: string, unit: string | undefined): string[][] {
  const items = (s.items as Doc[] | undefined) ?? [];
  const weight = s.total_weight != null ? Number(s.total_weight) : items.reduce((a, i) => a + Number(i.weight ?? 0) * Number(i.qty ?? 0), 0);
  const kg = unit === "lbs" ? weight * LBS_TO_KG : weight;
  const qty = items.reduce((a, i) => a + Number(i.qty ?? 0), 0);
  const tracks = ((s.tracks as Doc[] | undefined) ?? []).filter((t) => str(t.track_number));
  // A shipment without a tracking number still gets a row (blank AWB), so it isn't silently lost.
  return (tracks.length ? tracks : [{} as Doc]).map((t) => [
    str(t.track_number), orderNo, str(s.increment_id), isoTime(s.created_at), str(t.title || t.carrier_code), num(Math.round(kg * 1000) / 1000), unit ?? "kgs (assumed)", num(qty),
  ]);
}

export const magento: Connector<MagentoCredentials> = {
  id: "magento",
  label: "Magento 2",
  description: "Orders, invoices, refunds and shipments from your Magento 2 / Adobe Commerce store, read-only, for the webstore reconciliations.",
  fields: [
    { key: "baseUrl", label: "Store address", secret: false, placeholder: "https://shop.example.com" },
    {
      key: "accessToken",
      label: "Integration access token",
      secret: true,
      help: "In the Magento admin: System → Extensions → Integrations → Add New Integration. Under API, give it Sales → Operations (Orders, Invoices, Credit Memos, Shipments) and Stores → Settings, save, Activate, and copy the Access Token. On Magento 2.4.4 or later also set Stores → Configuration → Services → OAuth → “Allow OAuth Access Tokens to be used as standalone Bearer tokens” to Yes.",
    },
  ],
  reports: REPORTS.map(({ id, label, description, slots }) => ({ id, label, description, slots })),

  parseCredentials(input) {
    const accessToken = (input.accessToken ?? "").trim();
    if (accessToken.length < 20 || /\s/.test(accessToken)) throw new ConnectorError("Paste the integration's full Access Token.");
    return { baseUrl: normaliseBaseUrl(input.baseUrl ?? ""), accessToken };
  },

  async test(creds, deps) {
    const q = searchQuery([], { size: 1, current: 1 }, "items[increment_id,store_name],total_count");
    const r = await get<SearchResult>(creds, `orders?${q}`, deps);
    const store = str(r.items?.[0]?.store_name).split("\n").pop(); // "Website\nStore\nStore view": the view's name
    return { accountLabel: `${store || new URL(creds.baseUrl).hostname} (${new URL(creds.baseUrl).hostname})` };
  },

  async pull(creds, report, window, deps) {
    const spec = REPORTS.find((r) => r.id === report);
    if (!spec) throw new ConnectorError(`Unknown Magento report: ${report}`);
    let rows: string[][];
    if (report === "orders") {
      rows = (await search(creds, "orders", window, deps)).map(orderRow);
    } else if (report === "invoices") {
      const invoices = await search(creds, "invoices", window, deps);
      const orders = await orderInfo(creds, invoices.map((i) => Number(i.order_id)), deps);
      rows = invoices.map((i) => invoiceRow(i, orders.get(Number(i.order_id)) ?? NO_ORDER));
    } else if (report === "credit_memo_lines") {
      const memos = await search(creds, "creditmemos", window, deps);
      const orders = await orderInfo(creds, memos.map((m) => Number(m.order_id)), deps);
      rows = memos.flatMap((m) => creditMemoRows(m, orders.get(Number(m.order_id))?.number ?? ""));
    } else {
      const shipments = await search(creds, "shipments", window, deps);
      const [orders, unit] = await Promise.all([orderInfo(creds, shipments.map((s) => Number(s.order_id)), deps), weightUnit(creds, deps)]);
      rows = shipments.flatMap((s) => shipmentRows(s, orders.get(Number(s.order_id))?.number ?? "", unit));
    }
    return { headers: [...spec.columns], rows };
  },
};
