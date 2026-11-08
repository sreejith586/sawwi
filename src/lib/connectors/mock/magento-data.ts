// A small, made-up Magento 2 store for tests and local demos (D-30). Everything is invented:
// "Sawwi Demo Store", AED, 5% VAT included in prices, October 2026, times in UTC. It covers
// card (Stripe), cash on delivery and BNPL (Tabby) orders, invoices for paid and delivered orders, a cancelled order, a partial and a
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

// Invented shoppers, at the reserved example.com domain.
const SHOPPERS: [first: string, last: string][] = [["Layla", "Haddad"], ["Omar", "Saleh"], ["Noura", "Al Amiri"], ["Yousef", "Karim"], ["Mariam", "Fares"], ["Khalid", "Nasser"]];

type Line = [sku: string, qty: number];
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Adobe Commerce gift cards used on an order, as Commerce stores them (a JSON list of {c, a}). In this
 * mock the order totals are left as they were, so the other demos don't change (D-57).
 */
const giftCards = (...cards: [code: string, amount: number][]): Doc => ({
  gift_cards: JSON.stringify(cards.map(([c, a]) => ({ c, a, ba: a }))), gift_cards_amount: cards.reduce((s, [, a]) => s + a, 0),
});

function shopper(entity: number): Doc {
  const [first, last] = SHOPPERS[entity % SHOPPERS.length];
  return { customer_firstname: first, customer_lastname: last, customer_email: `${first}.${last.replace(/\s+/g, "")}@example.com`.toLowerCase() };
}

function order(entity: number, inc: string, created: string, status: string, method: string, lines: Line[], extra: Doc = {}): Doc {
  const subtotalIncl = lines.reduce((a, [sku, qty]) => a + PRODUCTS[sku].price * qty, 0);
  const shipping = subtotalIncl >= 300 ? 0 : 20;
  const cod = method === "cashondelivery" ? 10 : 0;
  const grand = r2(subtotalIncl + shipping + cod);
  const tax = r2((grand * 5) / 105);
  const paid = status === "canceled" || (method === "cashondelivery" && status !== "complete") ? 0 : grand;
  return {
    entity_id: entity, increment_id: inc, created_at: created, updated_at: created, status, state: status === "canceled" ? "canceled" : status,
    store_id: 1, store_name: STORE_NAME, ...shopper(entity), order_currency_code: "AED", base_currency_code: "AED",
    subtotal: r2(subtotalIncl - (subtotalIncl * 5) / 105), discount_amount: 0, shipping_amount: shipping + cod, tax_amount: tax, grand_total: grand, total_paid: paid,
    base_grand_total: grand, base_to_order_rate: 1,
    payment: { method, additional_information: [PAYMENTS[method]] },
    items: lines.map(([sku, qty], i) => ({ item_id: entity * 10 + i, sku, name: PRODUCTS[sku].name, qty_ordered: qty, price: PRODUCTS[sku].price, weight: PRODUCTS[sku].weight })),
    ...extra,
  };
}

// Store views (D-58): one website, base currency AED, three store views in their own currency.
export const DEMO_STORE_VIEWS: Doc[] = [
  { id: 1, code: "uae_en", name: DEMO_STORE_NAME, website_id: 1, store_group_id: 1, is_active: 1 },
  { id: 2, code: "ksa_ar", name: "Sawwi Demo Store KSA", website_id: 1, store_group_id: 1, is_active: 1 },
  { id: 3, code: "omn_en", name: "Sawwi Demo Store Oman", website_id: 1, store_group_id: 1, is_active: 1 },
];
const ABROAD: Record<string, { id: number; currency: string; rate: number; vat: number }> = {
  ksa_ar: { id: 2, currency: "SAR", rate: 1.021, vat: 15 },
  omn_en: { id: 3, currency: "OMR", rate: 0.1048, vat: 5 },
};

/** An order in another store view: totals in its currency at the rate Magento recorded, base in AED. */
function abroad(entity: number, created: string, store: string, base: number, lines: Line[]): Doc {
  const s = ABROAD[store];
  const grand = r2(base * s.rate);
  const tax = r2((grand * s.vat) / (100 + s.vat));
  const view = DEMO_STORE_VIEWS.find((v) => v.id === s.id)!;
  return order(entity, String(entity).padStart(9, "0"), created, "complete", "cashondelivery", lines, {
    store_id: s.id, store_name: `Main Website\nMain Website Store\n${view.name}`, order_currency_code: s.currency,
    subtotal: r2(grand - tax), shipping_amount: 0, tax_amount: tax, grand_total: grand, total_paid: grand, base_grand_total: base, base_to_order_rate: s.rate,
  });
}

export const DEMO_ORDERS: Doc[] = [
  order(100, "000000100", "2026-09-30 23:30:00", "complete", "stripe_payments", [["OUD-50", 1]]),
  order(101, "000000101", "2026-10-01 08:12:44", "complete", "stripe_payments", [["ABY-BLK-M", 1], ["MAT-01", 1]], { ...giftCards(["GC-AAA1", 120]), customer_balance_amount: 30 }),
  order(102, "000000102", "2026-10-02 19:40:03", "complete", "cashondelivery", [["SND-42", 1]]),
  order(103, "000000103", "2026-10-04 11:05:51", "closed", "stripe_payments", [["OUD-50", 1]], { total_refunded: 305, total_online_refunded: 305 }),
  order(104, "000000104", "2026-10-07 21:18:30", "complete", "tabby_installments", [["ABY-BLK-M", 2]], giftCards(["GC-BBB2", 250])),
  order(105, "000000105", "2026-10-09 14:02:11", "canceled", "cashondelivery", [["MAT-01", 2]]),
  order(106, "000000106", "2026-10-12 09:55:27", "complete", "stripe_payments", [["SND-42", 1], ["OUD-50", 1]], { total_refunded: 199, total_online_refunded: 199, customer_balance_amount: 60 }),
  order(107, "000000107", "2026-10-15 17:31:09", "processing", "cashondelivery", [["ABY-BLK-M", 1]]),
  order(108, "000000108", "2026-10-21 12:47:38", "complete", "stripe_payments", [["MAT-01", 3]], { total_refunded: 15, total_offline_refunded: 15, total_online_refunded: 0, ...giftCards(["GC-ZZZ9", 40]) }),
  order(109, "000000109", "2026-10-26 20:20:20", "processing", "tabby_installments", [["OUD-50", 1], ["SND-42", 1]]),
  order(110, "000000110", "2026-10-31 23:59:00", "pending", "stripe_payments", [["MAT-01", 1]]),
  order(111, "000000111", "2026-11-01 00:10:00", "pending", "cashondelivery", [["SND-42", 1]]),
  // The KSA (SAR, 15% VAT) and Oman (OMR) store views, cash on delivery and delivered (D-58).
  abroad(120, "2026-10-10 10:00:00", "ksa_ar", 1000, [["ABY-BLK-M", 2]]),
  abroad(121, "2026-10-14 15:30:00", "ksa_ar", 500, [["OUD-50", 1]]),
  abroad(122, "2026-10-24 18:45:00", "ksa_ar", 2000, [["ABY-BLK-M", 4]]),
  abroad(123, "2026-10-27 12:10:00", "omn_en", 500, [["SND-42", 2]]),
];

/** Invoices: card and Tabby orders are invoiced when paid, COD orders when delivered. */
function invoice(entity: number, inc: string, orderId: number, created: string): Doc {
  const o = DEMO_ORDERS.find((x) => x.entity_id === orderId)!;
  return {
    entity_id: entity, increment_id: inc, order_id: orderId, created_at: created, state: 2, store_id: o.store_id,
    order_currency_code: o.order_currency_code, base_currency_code: o.base_currency_code, base_to_order_rate: o.base_to_order_rate,
    subtotal: o.subtotal, shipping_amount: o.shipping_amount, discount_amount: 0, tax_amount: o.tax_amount, grand_total: o.grand_total, base_grand_total: o.base_grand_total,
  };
}

export const DEMO_INVOICES: Doc[] = [
  invoice(400, "000000400", 100, "2026-09-30 23:31:00"), // September, outside the month
  invoice(401, "000000401", 101, "2026-10-01 08:13:02"),
  invoice(402, "000000402", 102, "2026-10-04 12:00:00"), // COD, invoiced on delivery
  invoice(403, "000000403", 103, "2026-10-04 11:06:10"),
  invoice(404, "000000404", 104, "2026-10-07 21:19:00"),
  invoice(406, "000000406", 106, "2026-10-12 09:56:00"),
  invoice(408, "000000408", 108, "2026-10-21 12:48:00"),
  invoice(420, "000000420", 120, "2026-10-11 16:00:00"), // KSA and Oman COD orders, invoiced on delivery
  invoice(421, "000000421", 121, "2026-10-15 17:00:00"),
  invoice(422, "000000422", 122, "2026-10-25 12:00:00"),
  invoice(423, "000000423", 123, "2026-10-28 14:00:00"),
  // 107 (COD, not delivered), 109 (Tabby, not captured) and 110 (pending) have no invoice yet.
];

function memo(entity: number, inc: string, orderId: number, created: string, lines: Line[], extra: { shipping?: number; adjustment?: number } = {}): Doc {
  const items = lines.map(([sku, qty], i) => {
    const incl = PRODUCTS[sku].price * qty;
    const tax = r2((incl * 5) / 105);
    return { entity_id: entity * 10 + i, sku, name: PRODUCTS[sku].name, qty, price: r2(PRODUCTS[sku].price - (PRODUCTS[sku].price * 5) / 105), row_total: r2(incl - tax), tax_amount: tax, discount_amount: 0 };
  });
  const shipping = extra.shipping ?? 0;
  const adjustment = extra.adjustment ?? 0;
  const grand = r2(lines.reduce((a, [sku, qty]) => a + PRODUCTS[sku].price * qty, 0) + shipping + adjustment);
  return {
    entity_id: entity, increment_id: inc, order_id: orderId, created_at: created, order_currency_code: "AED",
    subtotal: r2(items.reduce((a, i) => a + i.row_total, 0)), tax_amount: r2(items.reduce((a, i) => a + i.tax_amount, 0) + (shipping * 5) / 105), shipping_amount: shipping, // adjustments carry no VAT discount_amount: 0,
    adjustment, adjustment_positive: Math.max(adjustment, 0), adjustment_negative: Math.max(-adjustment, 0), grand_total: grand, items,
  };
}

export const DEMO_CREDIT_MEMOS: Doc[] = [
  memo(501, "000000501", 103, "2026-10-08 10:00:00", [["OUD-50", 1]], { shipping: 20 }), // full refund incl. 20 shipping
  memo(502, "000000502", 106, "2026-10-19 15:45:00", [["SND-42", 1]]), // sandals returned
  memo(503, "000000503", 108, "2026-10-24 11:30:00", [], { adjustment: 15 }), // goodwill refund, offline as store credit, no items back
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

// Multi-Source Inventory: two sources, the Dubai warehouse ("default") and a Sharjah shop
// ("shj"). Planted against the demo store's Business Central items (web-erp-stock, D-54):
//  - OUD-50: 10 sellable, Business Central holds 4 (overselling).
//  - SND-42: the Sharjah shop's 5 are set out of stock, so 15 sellable against 20 (hidden stock).
//  - OUD-100: in the store, unknown to Business Central.
export const DEMO_SOURCE_ITEMS: Doc[] = [
  { sku: "ABY-BLK-M", source_code: "default", quantity: 12, status: 1 },
  { sku: "MAT-01", source_code: "default", quantity: 18, status: 1 },
  { sku: "MAT-01", source_code: "shj", quantity: 12, status: 1 },
  { sku: "OUD-100", source_code: "default", quantity: 6, status: 1 },
  { sku: "OUD-50", source_code: "default", quantity: 10, status: 1 },
  { sku: "SND-42", source_code: "default", quantity: 15, status: 1 },
  { sku: "SND-42", source_code: "shj", quantity: 5, status: 0 },
];

// Catalogue prices (VAT included, as in Business Central's items). Planted against the store
// company's unit prices (web-erp-prices, D-55):
//  - ABY-BLK-M: a special price that ended on 15 October and is still set.
//  - SND-42: 189.00 in the store, 199.00 in Business Central.
//  - MAT-01: a special price above the regular price.
//  - OUD-100: priced in the store, not an item in Business Central.
//  - ABY-BLK: a configurable parent, which a pull leaves out (its children carry the price).
const special = (price: number, from?: string, to?: string) => [
  { attribute_code: "special_price", value: String(price) },
  ...(from ? [{ attribute_code: "special_from_date", value: `${from} 00:00:00` }] : []),
  ...(to ? [{ attribute_code: "special_to_date", value: `${to} 00:00:00` }] : []),
];
const product = (id: number, sku: string, name: string, price: number | undefined, custom: { attribute_code: string; value: string }[] = [], type_id = "simple"): Doc => ({
  id, sku, name, type_id, status: 1, visibility: 4, ...(price !== undefined && { price }), custom_attributes: [{ attribute_code: "url_key", value: sku.toLowerCase() }, ...custom],
});
export const DEMO_PRODUCTS: Doc[] = [
  product(1, "ABY-BLK", "Classic black abaya", undefined, [], "configurable"),
  product(2, "ABY-BLK-M", PRODUCTS["ABY-BLK-M"].name, 420, special(380, "2026-09-01", "2026-10-15")),
  product(3, "OUD-50", PRODUCTS["OUD-50"].name, 285, special(260, "2026-10-20", "2026-11-30")),
  product(4, "SND-42", PRODUCTS["SND-42"].name, 189),
  product(5, "MAT-01", PRODUCTS["MAT-01"].name, 75, special(80)),
  product(6, "OUD-100", "Oud perfume 100 ml", 450),
];

// Adobe Commerce gift card accounts (web-gift-cards, D-57), with the balance history the
// roll-forward reads (actions: 0 created, 1 used, 4 expired). Planted:
//  - GC-BBB2: issued 200, used for 250 on order 104 (over-redeemed, balance -50).
//  - GC-CCC3: 300, expired 100, yet the balance says 250 (roll-forward break).
//  - GC-DDD4: created after October, left out of the month.
//  - Order 108 used GC-ZZZ9, which has no account (redeemed without issuance).
const history = (...e: [day: string, action: number, delta: number, balance: number][]) => e.map(([d, action, balance_delta, balance_amount]) => ({ updated_at: `${d} 09:00:00`, action, balance_delta, balance_amount }));
const card = (id: number, code: string, created: string, balance: number, h: ReturnType<typeof history>): Doc => ({
  giftcard_id: id, code, status: 1, state: balance > 0 ? 0 : 1, date_created: created, date_expires: "2027-12-31", website_id: 1, balance, is_redeemable: 1, history: h,
});
export const DEMO_GIFT_CARDS: Doc[] = [
  card(1, "GC-AAA1", "2026-08-01", 380, history(["2026-08-01", 0, 500, 500], ["2026-10-01", 1, -120, 380])),
  card(2, "GC-BBB2", "2026-10-03", -50, history(["2026-10-03", 0, 200, 200], ["2026-10-07", 1, -250, -50])),
  card(3, "GC-CCC3", "2026-06-01", 250, history(["2026-06-01", 0, 300, 300], ["2026-10-15", 4, -100, 250])),
  card(4, "GC-DDD4", "2026-11-02", 100, history(["2026-11-02", 0, 100, 100])),
];
