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
//  Multi-store, multi-currency (web-erp-fx): web invoices carry the store view in Global
//  Dimension 1. 000000121 (SAR) was posted in AED; 000000122 was posted after the SAR rate moved
//  (0.97 instead of Magento's 1/1.021), so its AED value is 19.26 lower; the Oman store's
//  000000123 was never posted.
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

const STORE_DIMENSION: Record<number, string> = { 1: "UAE_EN", 2: "KSA_AR", 3: "OMN_EN" };

function webInvoice(number: string, orderInc: string, over: { total?: number; tax?: number; email?: string; name?: string; status?: string; currency?: string } = {}): Doc {
  const o = orderOf(orderInc);
  const total = over.total ?? Number(o.grand_total);
  const tax = over.tax ?? (over.total === undefined ? Number(o.tax_amount) : r2((total * 5) / 105));
  const orderCurrency = String(o.order_currency_code);
  const date = nextDay(invoiceDateOf(orderInc)); // the connector posts the day after
  return {
    id: guid(), number, externalDocumentNumber: orderInc, invoiceDate: date, postingDate: date, dueDate: date,
    customerNumber: "WEB", customerName: over.name ?? `${o.customer_firstname} ${o.customer_lastname}`, email: over.email ?? o.customer_email,
    currencyCode: over.currency ?? (orderCurrency === "AED" ? "" : orderCurrency), shortcutDimension1Code: STORE_DIMENSION[Number(o.store_id)] ?? "",
    orderNumber: "", totalAmountExcludingTax: r2(total - tax), totalTaxAmount: tax, totalAmountIncludingTax: total,
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
    webInvoice("PSI-W1020", "000000120"),
    webInvoice("PSI-W1021", "000000121", { currency: "" }), // a SAR order posted in AED
    webInvoice("PSI-W1022", "000000122"),
    // 000000123 (Oman store) is never posted: that store isn't connected to Business Central.
  ],
  // LCY (AED) per unit: relationalExchangeRateAmount ÷ exchangeRateAmount. SAR moves on 20 October.
  currencyExchangeRates: [
    { id: guid(), currencyCode: "SAR", startingDate: "2026-01-01", exchangeRateAmount: 1, relationalCurrencyCode: "", relationalExchangeRateAmount: 0.98 },
    { id: guid(), currencyCode: "SAR", startingDate: "2026-10-20", exchangeRateAmount: 1, relationalCurrencyCode: "", relationalExchangeRateAmount: 0.97 },
    { id: guid(), currencyCode: "OMR", startingDate: "2026-01-01", exchangeRateAmount: 1, relationalCurrencyCode: "", relationalExchangeRateAmount: 9.54 },
  ],
  salesCreditMemos: [
    webCreditMemo("PCM-W2001", "000000103"),
    webCreditMemo("PCM-W2002", "000000103"), // the same refund posted again
    webCreditMemo("PCM-W2003", "000000106", { status: "Draft" }),
    webCreditMemo("PCM-W2004", "000000108", { total: 20 }),
  ],
};

// The marketplace seller's chart of accounts and a general journal batch, for settlement journals
// (D-71, D-73). Settlement S-2026-10-A is already posted, so the demo shows a duplicate refused (D-72).
// Added after the documents, so their ids don't move.
export const DEMO_STORE_JOURNAL_ID = "5707e000-0000-4000-8000-000000000a01";
Object.assign(DEMO_STORE_DATA, {
  accounts: [
    ["1150", "Marketplace clearing"],
    ["1160", "Marketplace reserve"],
    ["2310", "Output VAT"],
    ["2320", "Input VAT"],
    ["4010", "Marketplace sales"],
    ["4020", "Shipping income"],
    ["4030", "Sales returns and refunds"],
    ["4040", "Promotions and discounts"],
    ["4090", "Other income"],
    ["6110", "Marketplace commission"],
    ["6120", "Fulfilment fees"],
    ["6130", "Storage fees"],
    ["6140", "Advertising"],
    ["6190", "Other marketplace fees"],
  ].map(([number, displayName]) => ({ id: guid(), number, displayName, category: "", accountType: "Posting", directPosting: true, blocked: false })),
  journals: [{ id: DEMO_STORE_JOURNAL_ID, code: "DEFAULT", displayName: "Default journal batch", templateDisplayName: "GENERAL" }],
  generalLedgerEntries: [
    { id: guid(), entryNumber: 5101, postingDate: "2026-10-14", documentNumber: "S-2026-10-A", accountNumber: "1150", description: "Marketplace settlement S-2026-10-A", debitAmount: 1286.65, creditAmount: 0 },
  ],
});

// November cash-on-delivery web invoices for COD remittances (D-77). They're outside the October
// window the reconciliation demo pulls, so its results don't change. W1035 is already paid.
export const DEMO_STORE_PAYMENT_JOURNAL_ID = "5707e000-0000-4000-8000-000000000a02";
const codInvoice = (number: string, order: string, date: string, total: number, name: string, paid = false): Doc => ({
  id: guid(), number, externalDocumentNumber: order, invoiceDate: date, postingDate: date, dueDate: date, customerNumber: "WEB", customerName: name, email: "",
  currencyCode: "", shortcutDimension1Code: "AE", orderNumber: "", totalAmountExcludingTax: r2((total * 100) / 105), totalTaxAmount: r2((total * 5) / 105),
  totalAmountIncludingTax: total, remainingAmount: paid ? 0 : total, status: paid ? "Paid" : "Open", salesInvoiceLines: [],
});
(DEMO_STORE_DATA.salesInvoices as Doc[]).push(
  codInvoice("PSI-W1031", "000000131", "2026-11-02", 430, "Mariam Al Hashimi"),
  codInvoice("PSI-W1032", "000000132", "2026-11-02", 229, "Omar Haddad"),
  codInvoice("PSI-W1033", "000000133", "2026-11-03", 380, "Layla Nasser"),
  codInvoice("PSI-W1035", "000000135", "2026-11-04", 295, "Ahmed Saleh", true),
  codInvoice("PSI-W1036", "000000136", "2026-11-04", 159, "Fatima Rahman"),
);
Object.assign(DEMO_STORE_DATA, {
  customers: [
    { id: guid(), number: "WEB", displayName: "Web store customers", blocked: " " },
    { id: guid(), number: "COD-UNAPPLIED", displayName: "COD cash not yet matched", blocked: " " },
  ],
  customerPaymentJournals: [{ id: DEMO_STORE_PAYMENT_JOURNAL_ID, code: "CODRCPT", displayName: "COD receipts (balancing account 1170 Courier clearing)" }],
});
(DEMO_STORE_DATA.accounts as Doc[]).push(
  ...[["1020", "Bank: Emirates NBD current"], ["1170", "Courier COD clearing"], ["6150", "Courier COD fees"]].map(([number, displayName]) => ({ id: guid(), number, displayName, category: "", accountType: "Posting", directPosting: true, blocked: false })),
);
