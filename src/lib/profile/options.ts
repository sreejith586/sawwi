// Onboarding vocabulary. Every option is a chip: one click, no free text (except company name).

export type Option<T extends string> = { value: T; label: string; hint?: string };

export const CHANNELS = [
  { value: "marketplace", label: "Marketplaces", hint: "Amazon, Noon, Namshi…" },
  { value: "webstore", label: "Own webstore", hint: "Shopify, Magento, Salla…" },
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
