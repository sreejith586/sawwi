// Onboarding vocabulary. Every option is a chip: one click, no free text (except company name).

export type Option<T extends string> = { value: T; label: string; hint?: string };

export const CHANNELS = [
  { value: "marketplace", label: "Marketplaces", hint: "Amazon, Noon, Namshi or any other" },
  { value: "webstore", label: "Own webstore", hint: "Shopify, Magento or any platform" },
  { value: "b2b", label: "Direct to businesses", hint: "B2B portal, wholesale, sales team" },
] as const satisfies readonly Option<string>[];
export type Channel = (typeof CHANNELS)[number]["value"];

export const MARKETPLACES = [
  { value: "amazon_ae", label: "Amazon.ae" },
  { value: "amazon_sa", label: "Amazon.sa" },
  { value: "noon", label: "Noon" },
  { value: "namshi", label: "Namshi" },
  { value: "trendyol", label: "Trendyol" },
  { value: "other_marketplace", label: "Other" },
] as const satisfies readonly Option<string>[];
export type Marketplace = (typeof MARKETPLACES)[number]["value"];

export const WEBSTORE_PLATFORMS = [
  { value: "shopify", label: "Shopify" },
  { value: "magento1", label: "Magento 1" },
  { value: "magento2", label: "Magento 2 / Adobe Commerce" },
  { value: "woocommerce", label: "WooCommerce" },
  { value: "salla", label: "Salla" },
  { value: "zid", label: "Zid" },
  { value: "other_platform", label: "Other" },
] as const satisfies readonly Option<string>[];
export type WebstorePlatform = (typeof WEBSTORE_PLATFORMS)[number]["value"];

export const PAYMENT_METHODS = [
  { value: "gateway", label: "Card / online gateway", hint: "Checkout.com, Tap, PayTabs, Telr, Stripe" },
  { value: "cod", label: "Cash on delivery", hint: "Collected by courier" },
  { value: "bnpl", label: "Buy now, pay later", hint: "Tabby, Tamara" },
] as const satisfies readonly Option<string>[];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];

export const B2B_PAYMENT_METHODS = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cheque", label: "Cheques / PDCs", hint: "Incl. post-dated cheques" },
  { value: "payment_link", label: "Card / payment link" },
  { value: "cash", label: "Cash" },
] as const satisfies readonly Option<string>[];
export type B2BPaymentMethod = (typeof B2B_PAYMENT_METHODS)[number]["value"];

export const ACCOUNTING_SYSTEMS = [
  { value: "odoo", label: "Odoo" },
  { value: "zoho", label: "Zoho Books" },
  { value: "sap_b1", label: "SAP Business One" },
  { value: "dynamics", label: "Microsoft Dynamics" },
  { value: "netsuite", label: "NetSuite" },
  { value: "quickbooks", label: "QuickBooks" },
  { value: "tally", label: "Tally" },
  { value: "spreadsheets", label: "Spreadsheets only" },
  { value: "other_system", label: "Other" },
] as const satisfies readonly Option<string>[];
export type AccountingSystem = (typeof ACCOUNTING_SYSTEMS)[number]["value"];

export const COUNTRIES = [
  { value: "AE", label: "UAE", hint: "AED · VAT 5%" },
  { value: "SA", label: "Saudi Arabia", hint: "SAR · VAT 15%" },
  { value: "KW", label: "Kuwait", hint: "KWD" },
  { value: "QA", label: "Qatar", hint: "QAR" },
  { value: "BH", label: "Bahrain", hint: "BHD · VAT 10%" },
  { value: "OM", label: "Oman", hint: "OMR · VAT 5%" },
] as const satisfies readonly Option<string>[];
export type Country = (typeof COUNTRIES)[number]["value"];

export const ROLES = [
  { value: "finance", label: "Finance / Accounts" },
  { value: "receivables", label: "Receivables & Collections" },
  { value: "marketplace_ops", label: "Marketplace / E-com Ops" },
  { value: "fulfilment", label: "Warehouse & Fulfilment" },
  { value: "owner", label: "Founder / Owner" },
] as const satisfies readonly Option<string>[];
export type Role = (typeof ROLES)[number]["value"];

export function labelOf<T extends string>(options: readonly Option<T>[], value: T): string {
  return options.find((o) => o.value === value)?.label ?? value;
}
