// A small, made-up Magento 2 store for tests and local demos (D-30). Everything is invented:
// "Sawwi Demo Store", AED, 5% VAT included in prices, October 2026, times in UTC. It covers
// card (Stripe), cash on delivery and BNPL (Tabby) orders, a cancelled order, a partial and a
// full refund, a shipment with two tracking numbers and one with none, and two orders just
// outside the month so window filters are exercised.

type Doc = Record<string, unknown>;

export const DEMO_STORE_NAME = "Sawwi Demo Store";
const STORE_NAME = `Main Website\nMain Website Store\n${DEMO_STORE_NAME}`;

const PRODUCTS: Record<string, { name: string; price: number; weight: number }> = {
  "ABY-BLK-M": { name: "Classic black abaya, M", price: 420, weight: 0.6 },
  "OUD-50": { name: "Oud perfume 50 ml", price: 285, weight: 0.35 },
  "SND-42": { name: "Leather sandals, 42", price: 199, weight: 0.9 },
  "MAT-01": { name: "Travel prayer mat", price: 75, weight: 0.4 },
};

const PAYMENTS: Record<string, string> = { stripe_payments: "Credit Card (Stripe)", cashondelivery: "Cash On Delivery", tabby_installments: "Tabby: Pay in 4" };

type Line = [sku: string, qty: number];
const r2 = (n: number) => Math.round(n * 100) / 100;

function order(entity: number, inc: string, created: string, status: string, method: string, lines: Line[], extra: Doc = {}): Doc {
  const subtotalIncl = lines.reduce((a, [sku, qty]) => a + PRODUCTS[sku].price * qty, 0);
  const shipping = subtotalIncl >= 300 ? 0 : 20;
  const cod = method === "cashondelivery" ? 10 : 0;
  const grand = r2(subtotalIncl + shipping + cod);
  const tax = r2((grand * 5) / 105);
  const paid = status === "canceled" || (method === "cashondelivery" && status !== "complete") ? 0 : grand;
  return {
    entity_id: entity, increment_id: inc, created_at: created, updated_at: created, status, state: status === "canceled" ? "canceled" : status,
    store_id: 1, store_name: STORE_NAME, order_currency_code: "AED", base_currency_code: "AED",
    subtotal: r2(subtotalIncl - (subtotalIncl * 5) / 105), discount_amount: 0, shipping_amount: shipping + cod, tax_amount: tax, grand_total: grand, total_paid: paid,
    payment: { method, additional_information: [PAYMENTS[method]] },
    items: lines.map(([sku, qty], i) => ({ item_id: entity * 10 + i, sku, name: PRODUCTS[sku].name, qty_ordered: qty, price: PRODUCTS[sku].price, weight: PRODUCTS[sku].weight })),
    ...extra,
  };
}

export const DEMO_ORDERS: Doc[] = [
  order(100, "000000100", "2026-09-30 23:30:00", "complete", "stripe_payments", [["OUD-50", 1]]),
  order(101, "000000101", "2026-10-01 08:12:44", "complete", "stripe_payments", [["ABY-BLK-M", 1], ["MAT-01", 1]]),
  order(102, "000000102", "2026-10-02 19:40:03", "complete", "cashondelivery", [["SND-42", 1]]),
  order(103, "000000103", "2026-10-04 11:05:51", "closed", "stripe_payments", [["OUD-50", 1]], { total_refunded: 305 }),
  order(104, "000000104", "2026-10-07 21:18:30", "complete", "tabby_installments", [["ABY-BLK-M", 2]]),
  order(105, "000000105", "2026-10-09 14:02:11", "canceled", "cashondelivery", [["MAT-01", 2]]),
  order(106, "000000106", "2026-10-12 09:55:27", "complete", "stripe_payments", [["SND-42", 1], ["OUD-50", 1]], { total_refunded: 199 }),
  order(107, "000000107", "2026-10-15 17:31:09", "processing", "cashondelivery", [["ABY-BLK-M", 1]]),
  order(108, "000000108", "2026-10-21 12:47:38", "complete", "stripe_payments", [["MAT-01", 3]]),
  order(109, "000000109", "2026-10-26 20:20:20", "processing", "tabby_installments", [["OUD-50", 1], ["SND-42", 1]]),
  order(110, "000000110", "2026-10-31 23:59:00", "pending", "stripe_payments", [["MAT-01", 1]]),
  order(111, "000000111", "2026-11-01 00:10:00", "pending", "cashondelivery", [["SND-42", 1]]),
];

function memo(entity: number, inc: string, orderId: number, created: string, lines: Line[], adjustment = 0): Doc {
  const items = lines.map(([sku, qty], i) => {
    const incl = PRODUCTS[sku].price * qty;
    const tax = r2((incl * 5) / 105);
    return { entity_id: entity * 10 + i, sku, name: PRODUCTS[sku].name, qty, price: r2(PRODUCTS[sku].price - (PRODUCTS[sku].price * 5) / 105), row_total: r2(incl - tax), tax_amount: tax, discount_amount: 0 };
  });
  const grand = r2(lines.reduce((a, [sku, qty]) => a + PRODUCTS[sku].price * qty, 0) + adjustment);
  return { entity_id: entity, increment_id: inc, order_id: orderId, created_at: created, order_currency_code: "AED", grand_total: grand, adjustment, items };
}

export const DEMO_CREDIT_MEMOS: Doc[] = [
  memo(501, "000000501", 103, "2026-10-08 10:00:00", [["OUD-50", 1]], 20), // full refund incl. 20 shipping
  memo(502, "000000502", 106, "2026-10-19 15:45:00", [["SND-42", 1]]), // sandals returned
];

function ship(entity: number, inc: string, orderId: number, created: string, tracks: [carrier: string, awb: string][]): Doc {
  const o = DEMO_ORDERS.find((x) => x.entity_id === orderId)!;
  const items = (o.items as Doc[]).map((i) => ({ sku: i.sku, name: i.name, qty: i.qty_ordered, weight: i.weight }));
  return {
    entity_id: entity, increment_id: inc, order_id: orderId, created_at: created, total_weight: null, items,
    tracks: tracks.map(([title, track_number], i) => ({ entity_id: entity * 10 + i, carrier_code: "custom", title, track_number })),
  };
}

export const DEMO_SHIPMENTS: Doc[] = [
  ship(301, "000000301", 101, "2026-10-02 09:00:00", [["Aramex", "4410023301"]]),
  ship(302, "000000302", 102, "2026-10-03 10:30:00", [["Aramex", "4410023302"]]),
  ship(303, "000000303", 103, "2026-10-05 08:15:00", [["SMSA", "290118830"]]),
  ship(304, "000000304", 104, "2026-10-08 13:00:00", [["Aramex", "4410023304"], ["Aramex", "4410023305"]]), // two parcels
  ship(306, "000000306", 106, "2026-10-13 11:20:00", [["SMSA", "290118836"]]),
  ship(307, "000000307", 107, "2026-10-16 16:40:00", [["Aramex", "4410023307"]]),
  ship(308, "000000308", 108, "2026-10-22 09:05:00", []), // shipped without a tracking number
];

export const DEMO_STORE_CONFIGS: Doc[] = [{ id: 1, code: "default", website_id: 1, locale: "en_US", base_currency_code: "AED", default_display_currency_code: "AED", timezone: "Asia/Dubai", weight_unit: "kgs", base_url: "https://demo-store.sawwi-mock.example/" }];
