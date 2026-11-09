// Where each kind of settlement amount goes (D-70). A marketplace names its amounts its own way
// ("Principal", "ItemPrice", "Commission / referral fee", "FBAPerUnitFulfillmentFee"…); each
// name is classified into one of these buckets, and each bucket is mapped once to a G/L account.

export type Bucket =
  | "sales"
  | "shipping"
  | "promotions"
  | "refunds"
  | "commission"
  | "fulfilment"
  | "storage"
  | "advertising"
  | "fee_vat"
  | "sales_vat"
  | "reimbursements"
  | "other_fees"
  | "reserve"
  | "ignore";

export const BUCKETS: { id: Bucket; label: string; hint: string }[] = [
  { id: "sales", label: "Sales", hint: "Item prices. Map to a marketplace receivable instead if you already invoice these sales in the ERP." },
  { id: "shipping", label: "Shipping charged", hint: "Shipping paid by customers." },
  { id: "promotions", label: "Promotions and discounts", hint: "Coupons and promotions you funded." },
  { id: "refunds", label: "Refunds", hint: "Item prices refunded to customers." },
  { id: "commission", label: "Commission", hint: "Referral, commission and closing fees." },
  { id: "fulfilment", label: "Fulfilment and shipping fees", hint: "Pick, pack and delivery by the marketplace." },
  { id: "storage", label: "Storage fees", hint: "Warehouse storage and removals." },
  { id: "advertising", label: "Advertising", hint: "Sponsored products and ads deducted from the payout." },
  { id: "fee_vat", label: "VAT on fees (input VAT)", hint: "VAT the marketplace charged on its fees." },
  { id: "sales_vat", label: "Output VAT", hint: "VAT on sales, when the marketplace shows it or Sawwi splits it out." },
  { id: "reimbursements", label: "Reimbursements", hint: "Lost or damaged stock paid back." },
  { id: "other_fees", label: "Other fees", hint: "Anything else the marketplace charged." },
  { id: "reserve", label: "Reserve held or released", hint: "Amounts held back from a payout, or released from an earlier one." },
  { id: "ignore", label: "Not posted", hint: "Informational lines that aren't money (e.g. a repeated total)." },
];

export const bucketLabel = (b: Bucket) => BUCKETS.find((x) => x.id === b)?.label ?? b;

/** The account the payout itself goes to. Not a category bucket: it's the other side of every journal. */
export const PAYOUT_ACCOUNT_KEY = "payout";

/** CamelCase split ("FBAPerUnitFulfillmentFee" → "fba per unit fulfillment fee"), lower case, punctuation as spaces. */
const norm = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Ordered: the first pattern that matches the category's name wins. Names are compared lower-case
// with punctuation as spaces, so "Commission / referral fee" is "commission referral fee".
const RULES: [RegExp, Bucket][] = [
  [/\b(vat|tax)\b.*\b(fee|fees|commission|charge)s?\b|\bfee(s)? (vat|tax)\b|\bvat on fees\b/, "fee_vat"],
  [/\b(previous reserve|current reserve|reserve amount|reserve)\b/, "reserve"],
  [/\b(advertising|sponsored|ads|ad spend|cost of advertising)\b/, "advertising"],
  [/\b(reimbursement|reversal reimbursement|warehouse lost|warehouse damage|safe t)\b/, "reimbursements"],
  [/\b(storage|removal|disposal|long term storage)\b/, "storage"],
  [/\b(fba|fulfil+ment|fulfil+ed|pick|pack|weight handling|shipping fee|delivery fee|last mile|logistics)\b/, "fulfilment"],
  [/\b(commission|referral|closing fee|variable closing|selling fee)\b/, "commission"],
  [/\b(promotion|promo|coupon|discount|rebate|voucher)\b/, "promotions"],
  [/\b(shipping|delivery charge|shipping charge)\b/, "shipping"],
  [/\b(output vat|vat on sales|tax collected|sales tax|vat|tax)\b/, "sales_vat"],
  [/\b(principal|item price|itemprice|product sales|sale price|selling price|item amount|gross sales)\b/, "sales"],
  [/\b(fee|fees|charge|subscription|penalty|adjustment)\b/, "other_fees"],
];

/** The bucket for a category name, or undefined when the dictionary doesn't know it (the user picks). */
export function classify(category: string, transactionType = ""): Bucket | undefined {
  const name = norm(category);
  const type = norm(transactionType);
  for (const [re, bucket] of RULES) {
    if (!re.test(name)) continue;
    // A refunded item price is a refund, not negative sales.
    if (bucket === "sales" && /\brefund|return\b/.test(type)) return "refunds";
    return bucket;
  }
  return undefined;
}
