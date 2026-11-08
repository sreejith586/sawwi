// A small, made-up Business Central company for tests and local demos (D-29). Names, numbers
// and GUIDs are invented. October 2026, AED, 5% VAT. It has deliberate exceptions so every
// B2B and purchasing reconciliation finds something:
//
//  Order to cash (b2b-order-delivery-invoice)
//   - SO-1041: LED-40 ordered 100, delivered 80 in two shipments, invoiced 80.
//   - SO-1042: AC-18K delivered 5, invoiced 4 (delivered, not invoiced).
//   - SO-1043: CBL-25 ordered 30, nothing delivered yet.
//   - SI-3106: LED-40 invoiced with no order or delivery.
//   - SO-1039 was fully invoiced, so Business Central deleted it: its shipment and invoice remain.
//  Procure to pay (p2p-three-way-match)
//   - PO-7001: AC-18K ordered 20, received 18, invoiced 18.
//   - PO-7002: LED-40 received 500, not invoiced yet.
//   - PO-7003: FAN-1200 invoiced at 165 against a PO price of 160.
//   - PO-7004: ordered, nothing received.
//   - GLS-2307: vendor invoice with no PO or receipt.
//  Plus one draft invoice and one draft credit memo, which a pull must leave out.

type Doc = Record<string, unknown>;
const VAT = 0.05;
const r2 = (n: number) => Math.round(n * 100) / 100;
let seq = 0;
const guid = (prefix: string) => `${prefix}${String(++seq).padStart(4, "0")}-0000-4000-8000-00000000b0c0`.slice(0, 36);

export const DEMO_COMPANY = { id: "5a7d1e00-0000-4000-8000-0000000bc001", name: "SAWWI DEMO TRADING", displayName: "Sawwi Demo Trading LLC" };
const OTHER_COMPANY = { id: "5a7d1e00-0000-4000-8000-0000000bc002", name: "SAWWI DEMO HOLDING", displayName: "Sawwi Demo Holding" };
export const DEMO_COMPANIES = [DEMO_COMPANY, OTHER_COMPANY];
export const DEMO_COMPANY_INFORMATION = [{ id: DEMO_COMPANY.id, displayName: DEMO_COMPANY.displayName, currencyCode: "AED", country: "AE" }];

const ITEMS: Record<string, string> = { "FAN-1200": "Ceiling fan 1200 mm", "LED-40": "LED panel 40 W", "AC-18K": "Split AC 18,000 BTU", "CBL-25": "Cable roll 2.5 mm, 100 m" };
const CUSTOMERS: Record<string, string> = { C0001: "Al Waha Hotels", C0002: "Marina Facilities Management", C0003: "Desert Rose Contracting" };
const VENDORS: Record<string, string> = { V0001: "Coolbreeze Air Systems Co.", V0002: "Gulf Lighting Supplies" };

type L = { item: string; qty: number; price: number; shipped?: number; invoiced?: number; received?: number };

function salesLine(l: L, i: number) {
  const net = r2(l.qty * l.price);
  return {
    id: guid("1111"), sequence: (i + 1) * 10000, lineType: "Item", lineObjectNumber: l.item, description: ITEMS[l.item], unitOfMeasureCode: "PCS",
    quantity: l.qty, unitPrice: l.price, discountAmount: 0, discountPercent: 0, amountExcludingTax: net, taxPercent: VAT * 100, totalTaxAmount: r2(net * VAT),
    amountIncludingTax: r2(net * (1 + VAT)), netAmount: net, netTaxAmount: r2(net * VAT), netAmountIncludingTax: r2(net * (1 + VAT)),
  };
}
const totals = (ls: { netAmount: number; netTaxAmount: number }[]) => {
  const ex = r2(ls.reduce((a, l) => a + l.netAmount, 0));
  const tax = r2(ls.reduce((a, l) => a + l.netTaxAmount, 0));
  return { totalAmountExcludingTax: ex, totalTaxAmount: tax, totalAmountIncludingTax: r2(ex + tax) };
};

function salesInvoice(number: string, date: string, customer: string, order: string, ls: L[], extra: Doc = {}): Doc {
  const lines = ls.map(salesLine);
  const t = totals(lines);
  return {
    id: guid("2222"), number, externalDocumentNumber: "", invoiceDate: date, postingDate: date, dueDate: date.replace(/-\d\d$/, "-28"), customerNumber: customer, customerName: CUSTOMERS[customer],
    currencyCode: "", orderNumber: order, ...t, remainingAmount: t.totalAmountIncludingTax, status: "Open", salesInvoiceLines: lines, ...extra,
  };
}

function salesOrder(number: string, date: string, customer: string, po: string, ls: L[]): Doc {
  const lines = ls.map((l, i) => ({ ...salesLine(l, i), shippedQuantity: l.shipped ?? 0, invoicedQuantity: l.invoiced ?? 0, shipmentDate: date }));
  return { id: guid("3333"), number, externalDocumentNumber: po, orderDate: date, postingDate: date, customerNumber: customer, customerName: CUSTOMERS[customer], currencyCode: "", ...totals(lines), fullyShipped: false, status: "Open", salesOrderLines: lines };
}

function shipment(number: string, date: string, customer: string, order: string, ls: L[]): Doc {
  return {
    id: guid("4444"), number, externalDocumentNumber: "", postingDate: date, customerNumber: customer, customerName: CUSTOMERS[customer], currencyCode: "", orderNumber: order,
    salesShipmentLines: ls.map((l, i) => ({ id: guid("4455"), documentNo: number, sequence: (i + 1) * 10000, lineType: "Item", lineObjectNumber: l.item, description: ITEMS[l.item], unitOfMeasureCode: "PCS", unitPrice: l.price, quantity: l.qty, discountPercent: 0, taxPercent: 5, shipmentDate: date })),
  };
}

function purchaseLine(l: L, i: number) {
  const net = r2(l.qty * l.price);
  return {
    id: guid("5555"), sequence: (i + 1) * 10000, lineType: "Item", lineObjectNumber: l.item, description: ITEMS[l.item], unitOfMeasureCode: "PCS", quantity: l.qty, directUnitCost: l.price, unitCost: l.price,
    discountAmount: 0, discountPercent: 0, amountExcludingTax: net, taxPercent: 5, totalTaxAmount: r2(net * VAT), amountIncludingTax: r2(net * (1 + VAT)), netAmount: net, netTaxAmount: r2(net * VAT), netAmountIncludingTax: r2(net * (1 + VAT)),
  };
}

function purchaseOrder(number: string, date: string, vendor: string, ls: L[]): Doc {
  const lines = ls.map((l, i) => ({ ...purchaseLine(l, i), receivedQuantity: l.received ?? 0, invoicedQuantity: l.invoiced ?? 0, expectedReceiptDate: date.replace(/-\d\d$/, "-25") }));
  return { id: guid("6666"), number, orderDate: date, postingDate: date, vendorNumber: vendor, vendorName: VENDORS[vendor], currencyCode: "", ...totals(lines), fullyReceived: false, status: "Open", purchaseOrderLines: lines };
}

function receipt(number: string, date: string, vendor: string, order: string, ls: L[]): Doc {
  return {
    id: guid("7777"), number, postingDate: date, vendorNumber: vendor, vendorName: VENDORS[vendor], currencyCode: "", orderNumber: order,
    purchaseReceiptLines: ls.map((l, i) => ({ id: guid("7788"), sequence: (i + 1) * 10000, lineType: "Item", lineObjectNumber: l.item, description: ITEMS[l.item], unitOfMeasureCode: "PCS", unitCost: l.price, quantity: l.qty, discountPercent: 0, taxPercent: 5 })),
  };
}

function purchaseInvoice(number: string, vendorInvoice: string, date: string, vendor: string, order: string, ls: L[], extra: Doc = {}): Doc {
  const lines = ls.map(purchaseLine);
  return { id: guid("8888"), number, vendorInvoiceNumber: vendorInvoice, invoiceDate: date, postingDate: date, dueDate: date.replace(/-\d\d$/, "-28"), vendorNumber: vendor, vendorName: VENDORS[vendor], currencyCode: "", orderNumber: order, ...totals(lines), status: "Open", purchaseInvoiceLines: lines, ...extra };
}

export const DEMO_DATA: Record<string, Doc[]> = {
  salesOrders: [
    salesOrder("SO-1041", "2026-10-02", "C0001", "AWH-PO-5521", [
      { item: "FAN-1200", qty: 20, price: 250, shipped: 20, invoiced: 20 },
      { item: "LED-40", qty: 100, price: 40, shipped: 80, invoiced: 80 },
    ]),
    salesOrder("SO-1042", "2026-10-05", "C0002", "MFM-7781", [{ item: "AC-18K", qty: 5, price: 1800, shipped: 5, invoiced: 4 }]),
    salesOrder("SO-1043", "2026-10-22", "C0003", "DRC-0193", [{ item: "CBL-25", qty: 30, price: 95 }]),
    salesOrder("SO-1044", "2026-10-17", "C0001", "AWH-PO-5560", [{ item: "LED-40", qty: 50, price: 38, shipped: 50, invoiced: 50 }]),
  ],
  salesShipments: [
    shipment("SSH-2104", "2026-10-02", "C0003", "SO-1039", [{ item: "CBL-25", qty: 40, price: 95 }]),
    shipment("SSH-2101", "2026-10-06", "C0001", "SO-1041", [
      { item: "FAN-1200", qty: 20, price: 250 },
      { item: "LED-40", qty: 50, price: 40 },
    ]),
    shipment("SSH-2103", "2026-10-09", "C0002", "SO-1042", [{ item: "AC-18K", qty: 5, price: 1800 }]),
    shipment("SSH-2102", "2026-10-14", "C0001", "SO-1041", [{ item: "LED-40", qty: 30, price: 40 }]),
    shipment("SSH-2105", "2026-10-20", "C0001", "SO-1044", [{ item: "LED-40", qty: 50, price: 38 }]),
  ],
  salesInvoices: [
    salesInvoice("SI-3103", "2026-10-03", "C0003", "SO-1039", [{ item: "CBL-25", qty: 40, price: 95 }], { remainingAmount: 1990 }),
    salesInvoice("SI-3101", "2026-10-07", "C0001", "SO-1041", [
      { item: "FAN-1200", qty: 20, price: 250 },
      { item: "LED-40", qty: 50, price: 40 },
    ], { remainingAmount: 0, status: "Paid" }),
    salesInvoice("SI-3102", "2026-10-10", "C0002", "SO-1042", [{ item: "AC-18K", qty: 4, price: 1800 }]),
    salesInvoice("SI-3104", "2026-10-15", "C0001", "SO-1041", [{ item: "LED-40", qty: 30, price: 40 }]),
    salesInvoice("SI-3105", "2026-10-21", "C0001", "SO-1044", [{ item: "LED-40", qty: 50, price: 38 }]),
    salesInvoice("SI-3106", "2026-10-24", "C0002", "", [{ item: "LED-40", qty: 10, price: 40 }], { externalDocumentNumber: "MFM-7790" }),
    salesInvoice("SI-3107", "2026-10-30", "C0003", "", [{ item: "FAN-1200", qty: 2, price: 250 }], { status: "Draft" }),
  ],
  salesCreditMemos: [
    {
      id: guid("9999"), number: "SCM-501", externalDocumentNumber: "RMA-0088", creditMemoDate: "2026-10-18", postingDate: "2026-10-18", customerNumber: "C0003", customerName: CUSTOMERS.C0003,
      currencyCode: "", totalAmountExcludingTax: 190, totalTaxAmount: 9.5, totalAmountIncludingTax: 199.5, status: "Open", invoiceNumber: "SI-3103",
    },
    {
      id: guid("9999"), number: "SCM-502", externalDocumentNumber: "", creditMemoDate: "2026-10-29", postingDate: "2026-10-29", customerNumber: "C0001", customerName: CUSTOMERS.C0001,
      currencyCode: "", totalAmountExcludingTax: 80, totalTaxAmount: 4, totalAmountIncludingTax: 84, status: "Draft", invoiceNumber: "",
    },
  ],
  purchaseOrders: [
    purchaseOrder("PO-7001", "2026-10-01", "V0001", [{ item: "AC-18K", qty: 20, price: 1200, received: 18, invoiced: 18 }]),
    purchaseOrder("PO-7002", "2026-10-05", "V0002", [{ item: "LED-40", qty: 500, price: 22, received: 500 }]),
    purchaseOrder("PO-7003", "2026-10-12", "V0002", [{ item: "FAN-1200", qty: 120, price: 160, received: 100, invoiced: 100 }]),
    purchaseOrder("PO-7004", "2026-10-20", "V0001", [{ item: "AC-18K", qty: 10, price: 1200 }]),
  ],
  purchaseReceipts: [
    receipt("PRC-8001", "2026-10-08", "V0001", "PO-7001", [{ item: "AC-18K", qty: 18, price: 1200 }]),
    receipt("PRC-8002", "2026-10-09", "V0002", "PO-7002", [{ item: "LED-40", qty: 500, price: 22 }]),
    receipt("PRC-8003", "2026-10-16", "V0002", "PO-7003", [{ item: "FAN-1200", qty: 100, price: 160 }]),
  ],
  purchaseInvoices: [
    purchaseInvoice("PI-9001", "CAS-55120", "2026-10-10", "V0001", "PO-7001", [{ item: "AC-18K", qty: 18, price: 1200 }]),
    purchaseInvoice("PI-9002", "GLS-2291", "2026-10-18", "V0002", "PO-7003", [{ item: "FAN-1200", qty: 100, price: 165 }]),
    purchaseInvoice("PI-9003", "GLS-2307", "2026-10-27", "V0002", "", [{ item: "LED-40", qty: 50, price: 22 }]),
  ],
};

// Master data for purchase invoice capture (D-62): vendors with TRNs, items, and G/L accounts.
// Al Noor (V0003) has no TRN on file, so it matches by name.
const VENDOR_TRN: Record<string, string> = { V0001: "100234567800003", V0002: "100345678900003", V0003: "" };
const MASTER: Record<string, Doc[]> = {
  vendors: [
    ...Object.entries(VENDORS).map(([number, displayName]) => ({ id: guid("9990"), number, displayName, taxRegistrationNumber: VENDOR_TRN[number], currencyCode: "", blocked: " " })),
    { id: guid("9990"), number: "V0003", displayName: "Al Noor Packaging Materials", taxRegistrationNumber: "", currencyCode: "", blocked: " " },
    { id: guid("9990"), number: "V0009", displayName: "Old Supplier (blocked)", taxRegistrationNumber: "", currencyCode: "", blocked: "All" },
  ],
  items: Object.entries(ITEMS).map(([number, displayName]) => ({ id: guid("9991"), number, displayName, type: "Inventory", baseUnitOfMeasureCode: "PCS", gtin: "", blocked: false })),
  accounts: [
    ["5410", "Freight and delivery inwards"],
    ["6120", "Packaging materials"],
    ["6230", "Office supplies"],
    ["8110", "Bank charges"],
  ].map(([number, displayName]) => ({ id: guid("9992"), number, displayName, category: "Expense", accountType: "Posting", directPosting: true, blocked: false })),
};
Object.assign(DEMO_DATA, MASTER);
