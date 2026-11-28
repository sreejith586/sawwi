// Invented books for the demo's QuickBooks, Xero and NetSuite sources (D-85): one small trading
// company, October 2026, AED. Each provider's mock serves the same documents in its own shape,
// so the three connectors can be compared row for row. Planted for the reconciliations:
//   - INV-2041 is part paid, INV-2043 is open past its due date;
//   - credit note CN-301 corrects INV-2042;
//   - PO-7702's bill BILL-ZX-88 is priced 2.00 a unit above the order;
//   - receipt GRN-5502 is 2 units short of PO-7702.

export type DemoLine = { sku: string; description: string; qty: number; price: number; vatRate: number };
export type DemoSalesInvoice = { number: string; date: string; due: string; customerNo: string; customer: string; customerPo: string; salesOrder: string; paid: number; lines: DemoLine[] };
export type DemoCreditNote = { number: string; date: string; invoice: string; customerNo: string; customer: string; lines: DemoLine[] };
export type DemoPurchaseOrder = { number: string; date: string; expected: string; vendorNo: string; vendor: string; status: string; lines: (DemoLine & { received: number; billed: number })[] };
export type DemoBill = { number: string; posted: string; date: string; po: string; vendorNo: string; vendor: string; lines: DemoLine[] };
export type DemoReceipt = { number: string; date: string; po: string; vendorNo: string; vendor: string; lines: { sku: string; description: string; qty: number }[] };
export type DemoItem = { sku: string; name: string; onHand: number; price: number; tracked: boolean };

export const DEMO_ACCOUNTING_COMPANY = "Sawwi Demo Distribution LLC";
export const DEMO_ACCOUNTING_CURRENCY = "AED";

const line = (sku: string, description: string, qty: number, price: number): DemoLine => ({ sku, description, qty, price, vatRate: 5 });

export const DEMO_SALES_INVOICES: DemoSalesInvoice[] = [
  { number: "INV-2040", date: "2026-10-02", due: "2026-11-01", customerNo: "C-100", customer: "Gulf Retail Group", customerPo: "GRG-PO-551", salesOrder: "SO-880", paid: 3307.5, lines: [line("DST-100", "Desk stand, aluminium", 20, 120), line("CBL-200", "USB-C cable 2m", 30, 25)] },
  { number: "INV-2041", date: "2026-10-09", due: "2026-11-08", customerNo: "C-101", customer: "Emirates Office Supplies", customerPo: "EOS-7781", salesOrder: "SO-881", paid: 1000, lines: [line("MON-270", "27in monitor", 4, 850)] },
  { number: "INV-2042", date: "2026-10-15", due: "2026-11-14", customerNo: "C-100", customer: "Gulf Retail Group", customerPo: "GRG-PO-560", salesOrder: "SO-882", paid: 0, lines: [line("KBD-110", "Wireless keyboard", 15, 95), line("MSE-120", "Wireless mouse", 15, 45)] },
  { number: "INV-2043", date: "2026-10-01", due: "2026-10-15", customerNo: "C-102", customer: "Sharjah Learning Centre", customerPo: "", salesOrder: "", paid: 0, lines: [line("SRV-INST", "Installation service", 1, 600)] },
];

export const DEMO_CREDIT_NOTES: DemoCreditNote[] = [{ number: "CN-301", date: "2026-10-20", invoice: "INV-2042", customerNo: "C-100", customer: "Gulf Retail Group", lines: [line("KBD-110", "Wireless keyboard, returned faulty", 2, 95)] }];

export const DEMO_PURCHASE_ORDERS: DemoPurchaseOrder[] = [
  { number: "PO-7701", date: "2026-10-03", expected: "2026-10-10", vendorNo: "V-200", vendor: "Shenzhen Peripherals Co", status: "Fully Billed", lines: [{ ...line("KBD-110", "Wireless keyboard", 50, 52), received: 50, billed: 50 }] },
  { number: "PO-7702", date: "2026-10-12", expected: "2026-10-22", vendorNo: "V-201", vendor: "Dubai Display Trading", status: "Pending Billing/Partially Received", lines: [{ ...line("MON-270", "27in monitor", 12, 610), received: 10, billed: 10 }] },
];

export const DEMO_RECEIPTS: DemoReceipt[] = [
  { number: "GRN-5501", date: "2026-10-09", po: "PO-7701", vendorNo: "V-200", vendor: "Shenzhen Peripherals Co", lines: [{ sku: "KBD-110", description: "Wireless keyboard", qty: 50 }] },
  { number: "GRN-5502", date: "2026-10-21", po: "PO-7702", vendorNo: "V-201", vendor: "Dubai Display Trading", lines: [{ sku: "MON-270", description: "27in monitor", qty: 10 }] },
];

export const DEMO_BILLS: DemoBill[] = [
  { number: "SZP-55120", posted: "VB-1201", date: "2026-10-10", po: "PO-7701", vendorNo: "V-200", vendor: "Shenzhen Peripherals Co", lines: [line("KBD-110", "Wireless keyboard", 50, 52)] },
  { number: "BILL-ZX-88", posted: "VB-1202", date: "2026-10-23", po: "PO-7702", vendorNo: "V-201", vendor: "Dubai Display Trading", lines: [line("MON-270", "27in monitor", 10, 612)] },
];

export const DEMO_ITEMS: DemoItem[] = [
  { sku: "DST-100", name: "Desk stand, aluminium", onHand: 64, price: 120, tracked: true },
  { sku: "CBL-200", name: "USB-C cable 2m", onHand: 410, price: 25, tracked: true },
  { sku: "MON-270", name: "27in monitor", onHand: 18, price: 850, tracked: true },
  { sku: "KBD-110", name: "Wireless keyboard", onHand: 37, price: 95, tracked: true },
  { sku: "MSE-120", name: "Wireless mouse", onHand: 52, price: 45, tracked: true },
  { sku: "SRV-INST", name: "Installation service", onHand: 0, price: 600, tracked: false },
];

const r2 = (n: number) => Math.round(n * 100) / 100;
export const lineNet = (l: DemoLine) => r2(l.qty * l.price);
export const lineVat = (l: DemoLine) => r2((lineNet(l) * l.vatRate) / 100);
export const docNet = (lines: DemoLine[]) => r2(lines.reduce((s, l) => s + lineNet(l), 0));
export const docVat = (lines: DemoLine[]) => r2(lines.reduce((s, l) => s + lineVat(l), 0));
export const docTotal = (lines: DemoLine[]) => r2(docNet(lines) + docVat(lines));
export const inWindow = (date: string, from: string, to: string) => date >= from && date <= to;
