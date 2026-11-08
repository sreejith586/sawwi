import { DEMO_CREDIT_MEMOS, DEMO_INVOICES, DEMO_ORDERS } from "./magento-data";

// A second made-up Business Central company: the books of the demo Magento store (D-52). A web
// connector posts each Magento invoice as a posted sales invoice, with the Magento order number
// in External Document No. Everything is invented. AED, 5% VAT, October 2026. Planted:
//
//  Magento invoices vs BC posted invoices (web-erp-invoices)
//   - 000000102: posted to a guest customer, with another e-mail.
//   - 000000103: never synced (only a draft exists, which a pull leaves out).
//   - 000000104: posted twice.
//   - 000000106: posted at 504.00, with shipping, against a Magento invoice of 484.00.
//   - 000000108: posted with no VAT (total right, VAT 0).
//
//  Magento credit memos vs BC posted credit memos (web-erp-credit-memos)
//   - 000000103: refund posted twice.
//   - 000000106: never posted (only a draft exists).
//   - 000000108: a 15.00 goodwill refund posted as 20.00.
//
//  Items (web-erp-stock): the store's SKUs with their inventory, plus GIFT-BOX, which isn't sold
//  online. Against Magento's stock: OUD-50 holds 4 (Magento sells 10), SND-42 holds 20 (Magento
//  sells 15), and Magento's OUD-100 isn't an item here.
//
// It is kept apart from "Sawwi Demo Trading LLC" so the B2B demo results don't change.

type Doc = Record<string, unknown>;
const r2 = (n: number) => Math.round(n * 100) / 100;

export const DEMO_STORE_COMPANY = { id: "5a7d1e00-0000-4000-8000-0000000bc003", name: "SAWWI DEMO STORE", displayName: "Sawwi Demo Store LLC" };
export const DEMO_STORE_COMPANY_INFORMATION = [{ id: DEMO_STORE_COMPANY.id, displayName: DEMO_STORE_COMPANY.displayName, currencyCode: "AED", country: "AE" }];

let seq = 0;
const guid = () => `5707e000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const orderOf = (inc: string) => DEMO_ORDERS.find((o) => o.increment_id === inc)!;
const invoiceDateOf = (inc: string) => {
  const o = orderOf(inc);
  const inv = DEMO_INVOICES.find((i) => i.order_id === o.entity_id)!;
  return String(inv.created_at).slice(0, 10);
};
const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

function webInvoice(number: string, orderInc: string, over: { total?: number; tax?: number; email?: string; name?: string; status?: string } = {}): Doc {
  const o = orderOf(orderInc);
  const total = over.total ?? Number(o.grand_total);
  const tax = over.tax ?? r2((total * 5) / 105);
  const date = nextDay(invoiceDateOf(orderInc)); // the connector posts the day after
  return {
    id: guid(), number, externalDocumentNumber: orderInc, invoiceDate: date, postingDate: date, dueDate: date,
    customerNumber: "WEB", customerName: over.name ?? `${o.customer_firstname} ${o.customer_lastname}`, email: over.email ?? o.customer_email,
    currencyCode: "", orderNumber: "", totalAmountExcludingTax: r2(total - tax), totalTaxAmount: tax, totalAmountIncludingTax: total,
    remainingAmount: 0, status: over.status ?? "Paid", salesInvoiceLines: [],
  };
}

function webCreditMemo(number: string, orderInc: string, over: { total?: number; status?: string } = {}): Doc {
  const o = orderOf(orderInc);
  const m = DEMO_CREDIT_MEMOS.find((x) => x.order_id === o.entity_id)!;
  const total = over.total ?? Number(m.grand_total);
  const tax = r2((total * 5) / 105);
  const date = nextDay(String(m.created_at).slice(0, 10));
  return {
    id: guid(), number, externalDocumentNumber: orderInc, creditMemoDate: date, postingDate: date, dueDate: date,
    customerNumber: "WEB", customerName: `${o.customer_firstname} ${o.customer_lastname}`, email: o.customer_email,
    currencyCode: "", totalAmountExcludingTax: r2(total - tax), totalTaxAmount: tax, totalAmountIncludingTax: total, status: over.status ?? "Paid", invoiceNumber: "", salesCreditMemoLines: [],
  };
}

function item(number: string, displayName: string, inventory: number, unitPrice: number, type = "Inventory"): Doc {
  return { id: guid(), number, displayName, type, inventory, baseUnitOfMeasureCode: "PCS", unitPrice, priceIncludesTax: true, blocked: false, gtin: "" };
}

export const DEMO_STORE_DATA: Record<string, Doc[]> = {
  items: [
    item("ABY-BLK-M", "Classic black abaya, M", 12, 420),
    item("GIFT-BOX", "Gift box (showroom only)", 50, 15),
    item("MAT-01", "Travel prayer mat", 30, 75),
    item("OUD-50", "Oud perfume 50 ml", 4, 285),
    item("SND-42", "Leather sandals, 42", 20, 199),
    item("SHIP-STD", "Standard delivery", 0, 20, "Service"),
  ],
  salesInvoices: [
    webInvoice("PSI-W1001", "000000101"),
    webInvoice("PSI-W1002", "000000102", { email: "guest@example.com", name: "Web guest" }),
    webInvoice("PSI-W1003", "000000103", { status: "Draft" }),
    webInvoice("PSI-W1004", "000000104"),
    webInvoice("PSI-W1005", "000000104"), // the same order posted again
    webInvoice("PSI-W1006", "000000106", { total: 504 }),
    webInvoice("PSI-W1008", "000000108", { tax: 0 }),
  ],
  salesCreditMemos: [
    webCreditMemo("PCM-W2001", "000000103"),
    webCreditMemo("PCM-W2002", "000000103"), // the same refund posted again
    webCreditMemo("PCM-W2003", "000000106", { status: "Draft" }),
    webCreditMemo("PCM-W2004", "000000108", { total: 20 }),
  ],
};
