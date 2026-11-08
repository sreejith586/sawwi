import type { Template } from "@/lib/templates/types";

// Which built connector can fill which template's slots (D-47). Public pages say "connector" only
// where this map says so; everything else is "upload the export". The map is checked in tests
// against each connector's own report list, so a page can't claim a connector that doesn't exist.

export type ConnectorId = "shopify" | "magento" | "business-central";

export const CONNECTOR_NAMES: Record<ConnectorId, string> = {
  shopify: "Shopify",
  magento: "Magento 2 / Adobe Commerce",
  "business-central": "Microsoft Dynamics 365 Business Central",
};

/** connector → template id → slot key → connector report id. */
export const CONNECTOR_COVERAGE: Record<ConnectorId, Record<string, Record<string, string>>> = {
  shopify: {
    "web-orders-vs-gateway": { orders: "orders" },
    "web-cod-remittance": { orders: "orders" },
    "web-bnpl": { orders: "orders" },
  },
  magento: {
    "web-orders-vs-gateway": { orders: "orders" },
    "web-cod-remittance": { orders: "orders" },
    "web-bnpl": { orders: "orders" },
    "web-refunds-vs-returns": { refunds: "credit_memo_lines" },
    "web-courier-freight": { shipments: "shipment_tracks" },
    "web-erp-invoices": { store_invoices: "invoices" },
    "web-erp-credit-memos": { store_refunds: "credit_memos" },
    "web-erp-stock": { store_stock: "source_items" },
    "web-erp-prices": { store_prices: "product_prices" },
    "web-payouts-by-method": { method_sales: "payment_totals" },
  },
  "business-central": {
    "mkt-settlement-vs-sales": { sales: "sales_invoices" },
    "mkt-b2b-payment-release": { b2b_invoices: "sales_invoices" },
    "b2b-cash-application": { invoices: "sales_invoices" },
    "b2b-order-delivery-invoice": { orders: "sales_order_lines", deliveries: "sales_shipment_lines", invoices: "sales_invoice_lines" },
    "b2b-price-compliance": { invoice_lines: "sales_invoice_lines" },
    "b2b-returns-vs-credit-notes": { credit_notes: "sales_credit_memos" },
    "p2p-three-way-match": { po: "purchase_order_lines", grn: "purchase_receipt_lines", invoices: "purchase_invoice_lines" },
    "web-erp-invoices": { erp_invoices: "web_sales_invoices" },
    "web-erp-credit-memos": { erp_credit_notes: "web_sales_credit_memos" },
    "web-erp-stock": { erp_stock: "items" },
    "web-erp-prices": { erp_prices: "items" },
  },
};

/** The connectors that can fill some of this template's files, and which files. */
export function connectorsFor(template: Template): { id: ConnectorId; name: string; slots: string[] }[] {
  return (Object.keys(CONNECTOR_COVERAGE) as ConnectorId[]).flatMap((id) => {
    const slots = CONNECTOR_COVERAGE[id][template.id];
    if (!slots) return [];
    return [{ id, name: CONNECTOR_NAMES[id], slots: template.sources.filter((s) => s.key in slots).map((s) => s.label) }];
  });
}

/** Checks the engine runs for this template. Checks with no rule are listed for review, not calculated. */
export const automatedChecks = (t: Template) => t.checks.filter((c) => c.rule);
export const reviewChecks = (t: Template) => t.checks.filter((c) => !c.rule);
