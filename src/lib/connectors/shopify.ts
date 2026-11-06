import { ConnectorError, type Connector, type ConnectorDeps, type PullWindow } from "./types";

// Shopify orders, from the Admin GraphQL API (D-28). Auth: an Admin API access token from
// a custom app the merchant creates in their own Shopify admin (Settings → Apps → Develop
// apps), with the read-only `read_orders` scope (`read_all_orders` for orders older than
// 60 days). Sawwi only reads. The shop domain must be *.myshopify.com, so a connection can
// never point Sawwi's server at another host.
//
// Docs: https://shopify.dev/docs/api/admin-graphql/2026-10/queries/orders

export const SHOPIFY_API_VERSION = "2026-10";
const PAGE_SIZE = 250;
const MAX_ROWS = 200_000;
const MAX_ATTEMPTS = 5;

export type ShopifyCredentials = { shop: string; accessToken: string };

/** Fixed column names: the header fingerprint stays the same every pull, so the mapping is remembered. */
export const SHOPIFY_ORDER_COLUMNS = [
  "Order",
  "Created at",
  "Processed at",
  "Financial status",
  "Fulfillment status",
  "Payment gateway",
  "Currency",
  "Subtotal",
  "Discounts",
  "Shipping",
  "Taxes",
  "Total",
  "Total refunded",
  "Cancelled at",
  "Test order",
] as const;

const ORDERS_QUERY = `query SawwiOrders($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      name
      createdAt
      processedAt
      cancelledAt
      test
      displayFinancialStatus
      displayFulfillmentStatus
      paymentGatewayNames
      currencyCode
      subtotalPriceSet { shopMoney { amount } }
      totalDiscountsSet { shopMoney { amount } }
      totalShippingPriceSet { shopMoney { amount } }
      totalTaxSet { shopMoney { amount } }
      totalPriceSet { shopMoney { amount } }
      totalRefundedSet { shopMoney { amount } }
    }
  }
}`;

const SHOP_QUERY = "query SawwiShop { shop { name currencyCode } }";

type Money = { shopMoney: { amount: string } } | null;
export type ShopifyOrderNode = {
  name: string;
  createdAt: string;
  processedAt: string | null;
  cancelledAt: string | null;
  test: boolean;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  paymentGatewayNames: string[];
  currencyCode: string;
  subtotalPriceSet: Money;
  totalDiscountsSet: Money;
  totalShippingPriceSet: Money;
  totalTaxSet: Money;
  totalPriceSet: Money;
  totalRefundedSet: Money;
};

type GraphQLResponse<T> = { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };

export function normaliseShop(input: string): string {
  const shop = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  const full = shop.includes(".") ? shop : `${shop}.myshopify.com`;
  if (!/^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/.test(full)) {
    throw new ConnectorError("Enter your store's myshopify.com address, e.g. your-store.myshopify.com.");
  }
  return full;
}

/** Shopify search syntax for a UTC window of whole days, `to` inclusive. */
export function windowQuery(w: PullWindow): string {
  const end = new Date(Date.parse(`${w.to}T00:00:00Z`) + 86_400_000).toISOString().replace(".000Z", "Z");
  return `created_at:>='${w.from}T00:00:00Z' AND created_at:<'${end}'`;
}

const humanStatus = (s: string | null) => (s ? s.toLowerCase().replace(/_/g, " ") : "");

export function orderRow(o: ShopifyOrderNode): string[] {
  const amt = (m: Money) => m?.shopMoney.amount ?? "";
  return [
    o.name,
    o.createdAt,
    o.processedAt ?? "",
    humanStatus(o.displayFinancialStatus),
    humanStatus(o.displayFulfillmentStatus),
    o.paymentGatewayNames.join(", "),
    o.currencyCode,
    amt(o.subtotalPriceSet),
    amt(o.totalDiscountsSet),
    amt(o.totalShippingPriceSet),
    amt(o.totalTaxSet),
    amt(o.totalPriceSet),
    amt(o.totalRefundedSet),
    o.cancelledAt ?? "",
    o.test ? "yes" : "no",
  ];
}

async function graphql<T>(creds: ShopifyCredentials, query: string, variables: Record<string, unknown>, deps: ConnectorDeps): Promise<T> {
  const url = `https://${creds.shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  for (let attempt = 1; ; attempt++) {
    const res = await deps.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": creds.accessToken },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401) throw new ConnectorError("Shopify didn't accept the access token. Check it, or create a new one in your Shopify admin.");
    if (res.status === 402) throw new ConnectorError("This Shopify store is frozen or unpaid, so its data can't be read.");
    if (res.status === 403) throw new ConnectorError("The access token is missing the read_orders scope. Add it to the custom app and reinstall.");
    if (res.status === 404) throw new ConnectorError("No Shopify store answered at that address.");
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable) {
      if (attempt >= MAX_ATTEMPTS) throw new ConnectorError(`Shopify is busy (HTTP ${res.status}). Try again in a minute.`);
      const after = Number(res.headers.get("Retry-After"));
      await deps.sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * attempt);
      continue;
    }
    if (!res.ok) throw new ConnectorError(`Shopify returned HTTP ${res.status}.`);
    const body = (await res.json()) as GraphQLResponse<T>;
    if (body.errors?.length) {
      const codes = body.errors.map((e) => e.extensions?.code);
      if (codes.includes("THROTTLED") && attempt < MAX_ATTEMPTS) {
        await deps.sleep(1000 * attempt);
        continue;
      }
      if (codes.includes("ACCESS_DENIED")) throw new ConnectorError("The access token can't read orders. Give the custom app the read_orders scope.");
      throw new ConnectorError(`Shopify: ${body.errors[0].message}`);
    }
    if (!body.data) throw new ConnectorError("Shopify returned no data.");
    return body.data;
  }
}

export const shopify: Connector<ShopifyCredentials> = {
  id: "shopify",
  label: "Shopify",
  description: "Orders from your Shopify store, read-only, for the webstore reconciliations.",
  fields: [
    { key: "shop", label: "Store address", secret: false, placeholder: "your-store.myshopify.com" },
    {
      key: "accessToken",
      label: "Admin API access token",
      secret: true,
      placeholder: "shpat_…",
      help: "In Shopify admin: Settings → Apps → Develop apps → Create an app, give it the read_orders scope (read_all_orders for older than 60 days), install it and copy the Admin API access token.",
    },
  ],
  reports: [{ id: "orders", label: "Orders", description: "One row per order created in the period: status, gateway, totals and refunds.", slots: ["orders"] }],

  parseCredentials(input) {
    const accessToken = (input.accessToken ?? "").trim();
    if (accessToken.length < 20 || /\s/.test(accessToken)) throw new ConnectorError("Paste the full Admin API access token.");
    return { shop: normaliseShop(input.shop ?? ""), accessToken };
  },

  async test(creds, deps) {
    const data = await graphql<{ shop: { name: string; currencyCode: string } }>(creds, SHOP_QUERY, {}, deps);
    return { accountLabel: `${data.shop.name} (${creds.shop})` };
  },

  async pull(creds, report, window, deps) {
    if (report !== "orders") throw new ConnectorError(`Unknown Shopify report: ${report}`);
    const rows: string[][] = [];
    let after: string | null = null;
    do {
      const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyOrderNode[] } } = await graphql(
        creds,
        ORDERS_QUERY,
        { first: PAGE_SIZE, after, query: windowQuery(window) },
        deps,
      );
      rows.push(...data.orders.nodes.map(orderRow));
      if (rows.length > MAX_ROWS) throw new ConnectorError("More than 200,000 orders in that period. Pull a shorter period.");
      after = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
    } while (after);
    return { headers: [...SHOPIFY_ORDER_COLUMNS], rows };
  },
};
