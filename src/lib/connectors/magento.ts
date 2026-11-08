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
export function searchQuery(groups: { field: string; value: string; condition: string }[][], page?: { size: number; current: number; sort?: string[] }, fields?: string): string {
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
    (page.sort ?? ["entity_id"]).forEach((field, i) => {
      p.set(`searchCriteria[sortOrders][${i}][field]`, field);
      p.set(`searchCriteria[sortOrders][${i}][direction]`, "ASC");
    });
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
    if (res.status === 404 && path.startsWith("giftcardaccounts")) throw new ConnectorError("This store has no gift card accounts API. Gift cards are an Adobe Commerce feature, not part of Magento Open Source.");
    if (res.status === 404 && path.startsWith("inventory/")) throw new ConnectorError("This store has no Multi-Source Inventory API (Magento 2.3 or later, with the Inventory modules enabled), so stock can't be read. Export the stock from the admin and upload it instead.");
    if (res.status === 404) throw new ConnectorError("No Magento REST API answered at that address. Check the store URL.");
    if (!res.ok || body === undefined) throw new ConnectorError(`The store returned HTTP ${res.status}${body?.message ? `: ${body.message}` : ""}.`);
    return body;
  }
}

/** Every page of a search, stopping at total_count (Magento repeats the last page past the end). */
async function search(creds: MagentoCredentials, resource: string, w: PullWindow, deps: ConnectorDeps): Promise<Doc[]> {
  return searchAll(creds, resource, windowGroups(w), deps);
}

/** Every page for any filter groups, in a stable order (`sort`), stopping at total_count. */
async function searchAll(creds: MagentoCredentials, resource: string, groups: Parameters<typeof searchQuery>[0], deps: ConnectorDeps, sort?: string[]): Promise<Doc[]> {
  const out: Doc[] = [];
  for (let page = 1; ; page++) {
    const r = await get<SearchResult>(creds, `${resource}?${searchQuery(groups, { size: PAGE_SIZE, current: page, sort })}`, deps);
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
export const MAGENTO_CREDIT_MEMO_COLUMNS = ["Order ID", "Credit memo ID", "Refund date", "Customer e-mail", "Customer", "Subtotal", "Shipping refunded", "Adjustment", "VAT amount", "Credit memo total (incl. VAT)", "Currency"] as const;
export const MAGENTO_SOURCE_ITEM_COLUMNS = ["SKU", "Source", "Source quantity", "Stock status", "Sellable quantity"] as const;
export const MAGENTO_PRICE_COLUMNS = ["SKU", "Product", "Product type", "Status", "Price", "Special price", "Special price from", "Special price to", "Checked on"] as const;
export const MAGENTO_PAYMENT_TOTAL_COLUMNS = ["Payment provider", "Payment method", "Method code", "Orders", "Order total", "Refunded online", "Expected to receive", "Currency", "Period from", "Period to"] as const;
export const MAGENTO_GIFT_CARD_COLUMNS = ["Account", "Status", "Created", "Expires", "Opening balance", "Issued", "Expired", "Closing balance", "Period from", "Period to"] as const;
export const MAGENTO_REDEMPTION_COLUMNS = ["Account", "Type", "Order ID", "Redemption date", "Redeemed amount", "Currency"] as const;
export const MAGENTO_INVOICE_CURRENCY_COLUMNS = ["Order ID", "Store invoice no.", "Invoice date", "Store code", "Store", "Order currency", "Invoice total (FCY)", "Base currency", "Invoice total (base)", "Rate (base to order)", "Total ÷ rate"] as const;
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
  {
    id: "credit_memos",
    label: "Credit memos (totals)",
    description: "One row per credit memo created in the period, with its order, customer e-mail, VAT and total, including shipping and adjustment refunds.",
    slots: ["web-erp-credit-memos/store_refunds"],
    columns: MAGENTO_CREDIT_MEMO_COLUMNS,
  },
  {
    id: "source_items",
    label: "Stock by source (MSI source items)",
    description: "Current quantity of every SKU at every inventory source, and how much of it the store can sell (sources set to in stock). Not dated: it's the stock right now.",
    slots: ["web-erp-stock/store_stock"],
    columns: MAGENTO_SOURCE_ITEM_COLUMNS,
  },
  {
    id: "product_prices",
    label: "Product prices (with special prices)",
    description: "Every simple, virtual and downloadable product with its price, special price and the special price's dates, as set on the default store view right now.",
    slots: ["web-erp-prices/store_prices"],
    columns: MAGENTO_PRICE_COLUMNS,
  },
  {
    id: "payment_totals",
    label: "Sales by payment method",
    description: "Orders placed in the period that are being fulfilled or done, totalled per payment provider and method, net of refunds paid back through the provider.",
    slots: ["web-payouts-by-method/method_sales"],
    columns: MAGENTO_PAYMENT_TOTAL_COLUMNS,
  },
  {
    id: "gift_card_balances",
    label: "Gift card accounts (Adobe Commerce only)",
    description: "Adobe Commerce only (not Magento Open Source): every gift card account with its balance at the start and end of the period, and what was issued and expired in between.",
    slots: ["web-gift-cards/gift_cards"],
    columns: MAGENTO_GIFT_CARD_COLUMNS,
  },
  {
    id: "gift_card_redemptions",
    label: "Gift card and store credit redemptions (Adobe Commerce only)",
    description: "Adobe Commerce only: one row per gift card or store credit amount used on an order placed in the period.",
    slots: ["web-gift-cards/redemptions"],
    columns: MAGENTO_REDEMPTION_COLUMNS,
  },
  {
    id: "invoice_currencies",
    label: "Invoices by store and currency",
    description: "One row per invoice created in the period, with its store view, the order currency, the base currency and the exchange rate Magento recorded.",
    slots: ["web-erp-fx/store_invoices"],
    columns: MAGENTO_INVOICE_CURRENCY_COLUMNS,
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

export function creditMemoTotalRow(m: Doc, order: OrderInfo): string[] {
  const adjustment = m.adjustment ?? Number(m.adjustment_positive ?? 0) - Number(m.adjustment_negative ?? 0);
  return [
    order.number, str(m.increment_id), isoTime(m.created_at), order.email, order.name,
    num(m.subtotal ?? 0), num(m.shipping_amount ?? 0), num(adjustment), num(m.tax_amount ?? 0), num(m.grand_total), str(m.order_currency_code),
  ];
}

/** A source's quantity counts as sellable only while the source item is "in stock" (status 1). */
export function sourceItemRow(i: Doc): string[] {
  const qty = Number(i.quantity ?? 0);
  const inStock = Number(i.status) === 1;
  return [str(i.sku), str(i.source_code), num(qty), inStock ? "In stock" : "Out of stock", num(inStock ? qty : 0)];
}

/** Products with a price of their own; configurable, bundle and grouped parents take theirs from children. */
const PRICED_TYPES = "simple,virtual,downloadable";
const attr = (p: Doc, code: string) => ((p.custom_attributes as { attribute_code: string; value: unknown }[] | undefined) ?? []).find((a) => a.attribute_code === code)?.value;
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "");

/** Prices are current, so they are checked as of the period's end, or today if that is earlier. */
export function priceRow(p: Doc, checkedOn: string): string[] {
  const special = attr(p, "special_price");
  return [
    str(p.sku), str(p.name), str(p.type_id), Number(p.status) === 2 ? "Disabled" : "Enabled", num(p.price ?? 0),
    special === undefined || special === null || special === "" ? "" : num(special), day(attr(p, "special_from_date")), day(attr(p, "special_to_date")), checkedOn,
  ];
}

/**
 * Who pays the money out, from the payment method code. Wallets (Apple Pay, Google Pay) run through
 * a gateway, so they share its provider and stay apart by method title. Unknown codes keep their title.
 */
const PROVIDERS: [RegExp, string][] = [
  [/^stripe/, "Stripe"],
  [/^checkout/, "Checkout.com"],
  [/paypal/, "PayPal"],
  [/^braintree/, "Braintree"],
  [/^adyen/, "Adyen"],
  [/^tap/, "Tap"],
  [/paytabs/, "PayTabs"],
  [/telr/, "Telr"],
  [/^amazon_?pay/, "Amazon Pay"],
  [/tabby/, "Tabby"],
  [/tamara/, "Tamara"],
  [/^(cashondelivery|cod|msp_cashondelivery)/, "Cash on delivery"],
  [/^(checkmo|banktransfer|purchaseorder)$/, "Offline"],
];
export function paymentProvider(code: string, title: string): string {
  const c = code.toLowerCase();
  return PROVIDERS.find(([re]) => re.test(c))?.[1] ?? (title || code || "Unknown");
}

/** Orders being fulfilled or done; new, pending payment, on hold and cancelled ones aren't owed a payout. */
const PAYABLE_STATES = new Set(["processing", "complete", "closed"]);

export function paymentTotalRows(orders: Doc[], w: PullWindow): string[][] {
  const groups = new Map<string, { provider: string; title: string; code: string; orders: number; total: number; refunded: number; currency: string }>();
  for (const o of orders) {
    if (!PAYABLE_STATES.has(str(o.state))) continue;
    const payment = (o.payment ?? {}) as { method?: string; additional_information?: unknown[] };
    const code = str(payment.method);
    const title = str(payment.additional_information?.[0]) || code;
    const currency = str(o.order_currency_code);
    const key = `${code}\u0000${title}\u0000${currency}`;
    const g = groups.get(key) ?? { provider: paymentProvider(code, title), title, code, orders: 0, total: 0, refunded: 0, currency };
    g.orders++;
    g.total += Number(o.grand_total ?? 0);
    // Offline refunds (store credit, cash) don't come out of the provider's payouts.
    g.refunded += Number(o.total_online_refunded ?? o.total_refunded ?? 0);
    groups.set(key, g);
  }
  return [...groups.values()]
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.title.localeCompare(b.title) || a.currency.localeCompare(b.currency))
    .map((g) => [g.provider, g.title, g.code, num(g.orders), num(g.total), num(g.refunded), num(g.total - g.refunded), g.currency, w.from, w.to]);
}

// ─── Adobe Commerce: gift cards and store credit (D-57) ─────────────────────
// Gift card accounts are Adobe Commerce's `/V1/giftcardaccounts` (ACL Magento_GiftCardAccount::giftcardaccount).
// The roll-forward needs each account's balance history (actions as in Commerce's gift card
// history: 0 created, 1 used, 2 sent, 3 redeemed to store credit, 4 expired, 5 updated). Sawwi
// reads it from `history` on the account; until a live Commerce store confirms where the API
// returns it, an account without one stops the pull with a message rather than guessing.

type HistoryEntry = { updated_at?: string; action?: number | string; balance_delta?: number | string; balance_amount?: number | string };
const EXPIRED = 4;

export function giftCardRow(a: Doc, w: PullWindow): string[] | null {
  const history = a.history as HistoryEntry[] | undefined;
  if (!Array.isArray(history)) {
    throw new ConnectorError("This store's gift card API doesn't return balance history, so the roll-forward can't be built. Export the gift card accounts history from the admin and upload it instead.");
  }
  const created = str(a.date_created).slice(0, 10);
  if (created && created > w.to) return null;
  const entries = [...history].sort((x, y) => str(x.updated_at).localeCompare(str(y.updated_at)));
  const day = (e: HistoryEntry) => str(e.updated_at).slice(0, 10);
  const before = entries.filter((e) => day(e) < w.from);
  const inside = entries.filter((e) => day(e) >= w.from && day(e) <= w.to);
  const opening = before.length ? Number(before[before.length - 1].balance_amount ?? 0) : 0;
  const closing = inside.length ? Number(inside[inside.length - 1].balance_amount ?? 0) : opening;
  let issued = 0;
  let expired = 0;
  for (const e of inside) {
    const delta = Number(e.balance_delta ?? 0);
    if (Number(e.action) === EXPIRED) expired += -delta;
    else if (delta > 0) issued += delta;
  }
  if (!opening && !closing && !issued && !expired) return null;
  const status = Number(a.status) === 1 ? "Active" : "Inactive";
  return [str(a.code), status, created, str(a.date_expires).slice(0, 10), num(opening), num(issued), num(expired), num(closing), w.from, w.to];
}

/** Gift cards used on an order: Commerce keeps them as a JSON list of {c: code, a: amount}. */
function giftCardsOn(o: Doc): { code: string; amount: number }[] {
  const raw = (o.extension_attributes as Doc | undefined)?.gift_cards ?? o.gift_cards;
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      list = [];
    }
  }
  return (Array.isArray(list) ? list : []).map((g: Doc) => ({ code: str(g.c ?? g.code), amount: Number(g.a ?? g.amount ?? 0) })).filter((g) => g.code && g.amount);
}

export function redemptionRows(o: Doc): string[][] {
  if (str(o.state) === "canceled") return [];
  const base = [str(o.increment_id), isoTime(o.created_at)];
  const currency = str(o.order_currency_code);
  const rows = giftCardsOn(o).map((g) => [g.code, "Gift card", ...base, num(g.amount), currency]);
  const credit = Number(o.customer_balance_amount ?? 0);
  if (credit > 0) rows.push([str(o.customer_email), "Store credit", ...base, num(credit), currency]);
  return rows;
}

/** Store views by ID, for their codes; empty if the integration can't read Stores → Settings. */
async function storeViews(creds: MagentoCredentials, deps: ConnectorDeps): Promise<Map<number, { code: string; name: string }>> {
  try {
    const views = await get<Doc[]>(creds, "store/storeViews", deps);
    return new Map(views.map((v) => [Number(v.id), { code: str(v.code), name: str(v.name) }]));
  } catch (error) {
    if (error instanceof ConnectorError && /refused access/.test(error.message)) return new Map();
    throw error;
  }
}

/** Magento records base_to_order_rate on each document: base total × rate = total in the order currency. */
export function invoiceCurrencyRow(inv: Doc, orderNo: string, view: { code: string; name: string } | undefined): string[] {
  const rate = Number(inv.base_to_order_rate ?? 1) || 1;
  const total = Number(inv.grand_total ?? 0);
  return [
    orderNo, str(inv.increment_id), isoTime(inv.created_at), view?.code ?? str(inv.store_id), view?.name ?? "", str(inv.order_currency_code), num(total),
    str(inv.base_currency_code), num(inv.base_grand_total ?? total), num(rate), num(Math.round((total / rate) * 100) / 100),
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
  description: "Orders, invoices, refunds, shipments, stock and prices from your Magento 2 / Adobe Commerce store, read-only, for the webstore reconciliations.",
  fields: [
    { key: "baseUrl", label: "Store address", secret: false, placeholder: "https://shop.example.com" },
    {
      key: "accessToken",
      label: "Integration access token",
      secret: true,
      help: "In the Magento admin: System → Extensions → Integrations → Add New Integration. Under API, give it Sales → Operations (Orders, Invoices, Credit Memos, Shipments), Stores → Settings and, for stock and prices, Catalog → Inventory → Products and Stores → Inventory → Sources, save, Activate, and copy the Access Token. On Magento 2.4.4 or later also set Stores → Configuration → Services → OAuth → “Allow OAuth Access Tokens to be used as standalone Bearer tokens” to Yes.",
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
    } else if (report === "invoice_currencies") {
      const invoices = await search(creds, "invoices", window, deps);
      const [orders, views] = await Promise.all([orderInfo(creds, invoices.map((i) => Number(i.order_id)), deps), storeViews(creds, deps)]);
      rows = invoices.map((i) => invoiceCurrencyRow(i, orders.get(Number(i.order_id))?.number ?? "", views.get(Number(i.store_id))));
    } else if (report === "credit_memos") {
      const memos = await search(creds, "creditmemos", window, deps);
      const orders = await orderInfo(creds, memos.map((m) => Number(m.order_id)), deps);
      rows = memos.map((m) => creditMemoTotalRow(m, orders.get(Number(m.order_id)) ?? NO_ORDER));
    } else if (report === "gift_card_balances") {
      const accounts = await searchAll(creds, "giftcardaccounts", [], deps, ["giftcard_id"]);
      rows = accounts.map((a) => giftCardRow(a, window)).filter((r): r is string[] => r !== null);
    } else if (report === "gift_card_redemptions") {
      rows = (await search(creds, "orders", window, deps)).flatMap(redemptionRows);
    } else if (report === "payment_totals") {
      rows = paymentTotalRows(await search(creds, "orders", window, deps), window);
    } else if (report === "product_prices") {
      const today = new Date().toISOString().slice(0, 10);
      const checkedOn = window.to < today ? window.to : today;
      const products = await searchAll(creds, "products", [[{ field: "type_id", value: PRICED_TYPES, condition: "in" }]], deps);
      rows = products.map((p) => priceRow(p, checkedOn));
    } else if (report === "source_items") {
      // Multi-Source Inventory (Magento 2.3+). Current stock, so the window doesn't apply.
      rows = (await searchAll(creds, "inventory/source-items", [], deps, ["sku", "source_code"])).map(sourceItemRow);
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
