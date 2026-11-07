import type { DemoFile } from "./demo-files";

// Made-up files for the marketplace templates in the demo store (D-31, D-32): one invented seller
// on a generic marketplace, October 2026, AED, 5% VAT. Order IDs MP-10xx; settlements S-2026-10-A
// and -B. Every file plants a few exceptions. Nothing here is real.

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => r2(n).toFixed(2);

const CATEGORY: Record<string, { name: string; pct: number; fixed: number; fulfilment: number; slab: string } | undefined> = {
  Fashion: { name: "Fashion", pct: 15, fixed: 1, fulfilment: 9, slab: "0-1 kg" },
  Beauty: { name: "Beauty", pct: 10, fixed: 1, fulfilment: 8, slab: "0-0.5 kg" },
  Home: { name: "Home", pct: 12, fixed: 1, fulfilment: 11, slab: "1-2 kg" },
  // Electronics is deliberately missing from the rate card.
};
const SKUS: Record<string, { category: string; price: number; weight: number }> = {
  "ABY-BLK-M": { category: "Fashion", price: 420, weight: 0.6 },
  "OUD-50": { category: "Beauty", price: 285, weight: 0.35 },
  "MAT-01": { category: "Home", price: 75, weight: 0.4 },
  "CUP-SET": { category: "Home", price: 120, weight: 1.2 },
  "EAR-BT": { category: "Electronics", price: 199, weight: 0.2 },
};

type Sale = { order: string; invoice: string; date: string; sku: string; qty: number; vatOverride?: number };
const SALES: Sale[] = [
  { order: "MP-1001", invoice: "INV-MP-5001", date: "2026-10-02", sku: "ABY-BLK-M", qty: 1 },
  { order: "MP-1002", invoice: "INV-MP-5002", date: "2026-10-03", sku: "OUD-50", qty: 2 },
  { order: "MP-1003", invoice: "INV-MP-5003", date: "2026-10-05", sku: "MAT-01", qty: 3 },
  { order: "MP-1009", invoice: "INV-MP-5009", date: "2026-10-06", sku: "OUD-50", qty: 1 }, // never settled
  { order: "MP-1004", invoice: "INV-MP-5004", date: "2026-10-08", sku: "CUP-SET", qty: 1 }, // settled 10.00 short
  { order: "MP-1005", invoice: "INV-MP-5005", date: "2026-10-10", sku: "OUD-50", qty: 1 }, // commission at 15% instead of 10%
  { order: "MP-1006", invoice: "INV-MP-5006", date: "2026-10-12", sku: "ABY-BLK-M", qty: 1 }, // settled twice
  { order: "MP-1007", invoice: "INV-MP-5007", date: "2026-10-15", sku: "MAT-01", qty: 2 },
  { order: "MP-1008", invoice: "INV-MP-5008", date: "2026-10-18", sku: "EAR-BT", qty: 1 },
  { order: "MP-1010", invoice: "INV-MP-5010", date: "2026-10-20", sku: "ABY-BLK-M", qty: 1, vatOverride: 25 }, // VAT should be 20.00
];
const gross = (s: Sale) => SKUS[s.sku].price * s.qty;

const salesRows = SALES.map((s) => [s.order, s.invoice, s.date, s.sku, money(s.qty), money(gross(s)), money(s.vatOverride ?? (gross(s) * 5) / 105), "AED"]);

// Settlement lines: principal is the gross sale; fees per the rate card unless planted otherwise.
function settlementLine(settlement: string, date: string, order: string, sku: string, qty: number, principal: number, opts: { pct?: number; ads?: number } = {}): string[] {
  const cat = CATEGORY[SKUS[sku].category];
  const pct = opts.pct ?? cat?.pct ?? 10;
  const other = -(opts.ads ?? 0); // sponsored-product ads deducted on the order's line
  const commission = -(principal * (pct / 100) + (cat?.fixed ?? 1));
  const fulfilment = -((cat?.fulfilment ?? 8) * qty);
  const feeVat = (commission + fulfilment + other) * 0.05;
  return [order, settlement, date, "Order", sku, money(principal), money(commission), money(fulfilment), money(other), money(feeVat), money(principal + commission + fulfilment + other + feeVat), "AED"];
}
const A = ["S-2026-10-A", "2026-10-14"] as const;
const B = ["S-2026-10-B", "2026-10-28"] as const;
const settlementRows: string[][] = [
  settlementLine(...A, "MP-1001", "ABY-BLK-M", 1, 420, { ads: 350 }),
  settlementLine(...A, "MP-1002", "OUD-50", 2, 570),
  settlementLine(...A, "MP-1003", "MAT-01", 3, 225),
  settlementLine(...A, "MP-1004", "CUP-SET", 1, 110),
  settlementLine(...A, "MP-1005", "OUD-50", 1, 285, { pct: 15 }),
  settlementLine(...A, "MP-1006", "ABY-BLK-M", 1, 420),
  settlementLine(...B, "MP-1006", "ABY-BLK-M", 1, 420),
  settlementLine(...B, "MP-1007", "MAT-01", 2, 150, { ads: 250 }), // ads deducted 600.00 in total; ad invoices only cover 500.00
  settlementLine(...B, "MP-1008", "EAR-BT", 1, 199),
  settlementLine(...B, "MP-1010", "ABY-BLK-M", 1, 420),
  settlementLine(...B, "MP-1099", "EAR-BT", 1, 199), // no invoice for this order
];

// The marketplace's tax invoices for its fees: they back 12.40 less VAT than was deducted.
const feeTotal = -settlementRows.reduce((a, r) => a + Number(r[6]) + Number(r[7]) + Number(r[8]), 0);
const feeVatTotal = -settlementRows.reduce((a, r) => a + Number(r[9]), 0);
const firstHalf = r2(feeTotal * 0.55);
const feeInvoiceRows = [
  ["MKT-TI-2610-01", "2026-10-15", money(firstHalf), money(firstHalf * 0.05)],
  ["MKT-TI-2610-02", "2026-10-31", money(feeTotal - firstHalf), money(feeVatTotal - firstHalf * 0.05 - 12.4)],
];

const SALES_HEADERS = ["Order ID", "Invoice number", "Invoice date", "SKU", "Quantity", "Invoice amount (incl. VAT)", "VAT amount", "Currency"];
const SETTLEMENT_HEADERS = ["Order ID", "Settlement ID", "Settlement date", "Transaction type", "SKU", "Item price / principal", "Commission / referral fee", "Fulfilment fee", "Other fees", "VAT on fees", "Net amount paid", "Currency"];

export const MARKETPLACE_FILES: DemoFile[] = [
  {
    id: "mp_sales_register",
    label: "Marketplace sales register",
    description: "The seller's invoices for its marketplace orders. Planted: one invoice with the wrong VAT.",
    slots: ["mkt-settlement-vs-sales/sales", "mkt-returns-vs-invoiced/sales", "mkt-vat/sales"],
    headers: SALES_HEADERS,
    dateColumn: 2,
    rows: salesRows,
  },
  {
    id: "mp_settlement",
    label: "Marketplace settlement report",
    description: "Two October settlements, line by line, with fees and ad deductions. Planted: an order never settled, one paid short, one settled twice, one not invoiced, a commission above the rate card.",
    slots: ["mkt-settlement-vs-sales/settlement", "mkt-fee-rate-card/settlement", "mkt-ads-deductions/settlement", "mkt-vat/settlement"],
    headers: SETTLEMENT_HEADERS,
    dateColumn: 2,
    rows: settlementRows,
  },
  {
    id: "mp_rate_card",
    label: "Marketplace fee rate card",
    description: "Agreed commission and fulfilment fees by category. Electronics is missing on purpose.",
    slots: ["mkt-fee-rate-card/rate_card"],
    headers: ["Category", "Commission %", "Fixed / closing fee", "Weight / size slab", "Fulfilment fee"],
    dateColumn: -1,
    rows: Object.values(CATEGORY).map((c) => [c!.name, money(c!.pct), money(c!.fixed), c!.slab, money(c!.fulfilment)]),
  },
  {
    id: "mp_catalog",
    label: "Product catalogue",
    description: "The seller's SKUs with their marketplace category and weight.",
    slots: ["mkt-fee-rate-card/catalog"],
    headers: ["SKU", "Category", "Weight (kg)"],
    dateColumn: -1,
    rows: Object.entries(SKUS).map(([sku, s]) => [sku, s.category, money(s.weight)]),
  },
  {
    id: "mp_returns",
    label: "Marketplace returns report",
    description: "Returns and the refunds deducted from payouts. Planted: a refund above the invoice, more units returned than sold, a return for an order never invoiced, one not received back.",
    slots: ["mkt-returns-vs-invoiced/returns"],
    headers: ["Order ID", "SKU", "Quantity", "Return date", "Return type (customer / RTO)", "Return reason", "Refund deducted", "Item condition"],
    dateColumn: 3,
    rows: [
      ["MP-1002", "OUD-50", "1.00", "2026-10-12", "customer", "Changed mind", "285.00", "Sellable"],
      ["MP-1003", "MAT-01", "4.00", "2026-10-13", "customer", "Wrong colour", "225.00", "Sellable"], // 3 sold
      ["MP-1007", "MAT-01", "2.00", "2026-10-22", "RTO", "Undeliverable", "160.00", "Unknown"], // invoice 150.00; never came back
      ["MP-1097", "OUD-50", "1.00", "2026-10-19", "customer", "Damaged", "285.00", "Damaged"], // no such invoice
    ],
  },
  {
    id: "mp_returns_received",
    label: "Returns received at the warehouse",
    description: "Returned units the seller's warehouse booked in.",
    slots: ["mkt-returns-vs-invoiced/received"],
    headers: ["Order ID", "SKU", "Quantity", "Received date", "Condition"],
    dateColumn: 3,
    rows: [
      ["MP-1002", "OUD-50", "1.00", "2026-10-16", "Good"],
      ["MP-1003", "MAT-01", "3.00", "2026-10-15", "Good"],
      ["MP-1097", "OUD-50", "1.00", "2026-10-20", "Damaged"],
    ],
  },
  {
    id: "mp_b2b_invoices",
    label: "Marketplace business-order invoices",
    description: "The seller's open invoices to business buyers on the marketplace (a snapshot, so September's unpaid one is included).",
    slots: ["mkt-b2b-payment-release/b2b_invoices"],
    headers: ["Invoice number", "Order ID", "Buyer TRN / VAT no.", "Invoice date", "Payment terms (days)", "Invoice amount (incl. VAT)", "VAT amount", "Currency"],
    dateColumn: -1,
    rows: [
      ["INV-B2B-701", "MP-B701", "100234567800003", "2026-10-01", "30.00", "1050.00", "50.00", "AED"],
      ["INV-B2B-704", "MP-B704", "100918273600003", "2026-09-25", "30.00", "630.00", "30.00", "AED"], // not released, over 30 days
      ["INV-B2B-702", "MP-B702", "100234567800003", "2026-10-05", "30.00", "2100.00", "100.00", "AED"],
      ["INV-B2B-703", "MP-B703", "100556677800003", "2026-10-09", "30.00", "840.00", "40.00", "AED"],
      ["INV-B2B-705", "MP-B705", "100918273600003", "2026-10-11", "30.00", "525.00", "25.00", "AED"],
    ],
  },
  {
    id: "mp_b2b_payments",
    label: "Marketplace business-order payments",
    description: "What the marketplace released for those invoices. Planted: an amount on hold, an unexplained deduction, one released short.",
    slots: ["mkt-b2b-payment-release/payments"],
    headers: ["Invoice number", "Order ID", "Release date", "Released amount", "Held / reserve amount", "Deductions", "Payment status"],
    dateColumn: 2,
    rows: [
      ["INV-B2B-701", "MP-B701", "2026-10-31", "1050.00", "0.00", "0.00", "Released"],
      ["INV-B2B-702", "MP-B702", "2026-10-31", "1600.00", "500.00", "0.00", "Partially held"],
      ["INV-B2B-703", "MP-B703", "2026-10-31", "765.00", "0.00", "75.00", "Released with deduction"],
      ["INV-B2B-705", "MP-B705", "2026-10-31", "500.00", "0.00", "0.00", "Released"], // invoice 525.00
    ],
  },
  {
    id: "mp_inbound_shipments",
    label: "Inbound shipments to the marketplace warehouse",
    description: "Stock the seller sent to the marketplace's fulfilment centre.",
    slots: ["mkt-fulfilment-inventory/shipments"],
    headers: ["Shipment ID", "SKU", "Qty sent", "Ship date"],
    dateColumn: 3,
    rows: [
      ["FBA-SHP-01", "ABY-BLK-M", "50.00", "2026-10-03"],
      ["FBA-SHP-01", "OUD-50", "100.00", "2026-10-03"],
      ["FBA-SHP-02", "MAT-01", "80.00", "2026-10-10"],
    ],
  },
  {
    id: "mp_inventory_ledger",
    label: "Fulfilment inventory ledger",
    description: "The marketplace's stock movements. Planted: one inbound shipment received 4 units short.",
    slots: ["mkt-fulfilment-inventory/inventory_ledger"],
    headers: ["Shipment ID", "SKU", "Event type", "Quantity", "Event date"],
    dateColumn: 4,
    rows: [
      ["FBA-SHP-01", "ABY-BLK-M", "Receipt", "50.00", "2026-10-06"],
      ["FBA-SHP-01", "OUD-50", "Receipt", "96.00", "2026-10-06"], // 100 sent
      ["FBA-SHP-02", "MAT-01", "Receipt", "80.00", "2026-10-13"],
      ["", "OUD-50", "Customer shipment", "-12.00", "2026-10-20"],
      ["", "ABY-BLK-M", "Lost in warehouse", "-2.00", "2026-10-24"],
    ],
  },
  {
    id: "mp_fulfilment_reimbursements",
    label: "Fulfilment reimbursements",
    description: "What the marketplace paid back for lost or damaged stock.",
    slots: ["mkt-fulfilment-inventory/reimbursements"],
    headers: ["SKU", "Qty reimbursed", "Amount", "Reason"],
    dateColumn: -1,
    rows: [["ABY-BLK-M", "2.00", "760.00", "Lost in warehouse"]],
  },
  {
    id: "mp_claims",
    label: "Open marketplace claims",
    description: "Claims the seller filed with the marketplace. Planted: one unpaid and close to expiry, one paid only in part.",
    slots: ["mkt-claims-vs-reimbursements/claims"],
    headers: ["Claim / case ID", "Order ID", "SKU", "Claim date", "Claim amount", "Claim type"],
    dateColumn: -1,
    rows: [
      ["CASE-88101", "MP-1002", "OUD-50", "2026-09-10", "285.00", "Lost in transit"],
      ["CASE-88102", "MP-1004", "CUP-SET", "2026-10-08", "120.00", "Damaged in warehouse"],
      ["CASE-88103", "MP-1007", "MAT-01", "2026-10-20", "75.00", "Return not received"],
    ],
  },
  {
    id: "mp_claim_reimbursements",
    label: "Claim reimbursements",
    description: "What the marketplace paid against those claims.",
    slots: ["mkt-claims-vs-reimbursements/reimbursements"],
    headers: ["Claim / case ID", "Order ID", "Paid date", "Amount paid"],
    dateColumn: -1,
    rows: [
      ["CASE-88102", "MP-1004", "2026-10-25", "60.00"],
      ["CASE-88103", "MP-1007", "2026-10-30", "75.00"],
    ],
  },
  {
    id: "mp_ad_invoices",
    label: "Marketplace advertising invoices",
    description: "The marketplace's invoices for sponsored-product ads. They cover 500.00 of the 600.00 deducted.",
    slots: ["mkt-ads-deductions/ad_invoices"],
    headers: ["Invoice number", "Invoice date", "Campaign", "Amount", "VAT amount"],
    dateColumn: 1,
    rows: [
      ["ADS-INV-1031", "2026-10-15", "Sponsored products – abayas", "350.00", "17.50"],
      ["ADS-INV-1044", "2026-10-31", "Sponsored products – oud", "150.00", "7.50"],
    ],
  },
  {
    id: "mp_fee_invoices",
    label: "Marketplace fee tax invoices",
    description: "The marketplace's tax invoices for its October fees. They back 12.40 less VAT than was deducted.",
    slots: ["mkt-vat/fee_invoices"],
    headers: ["Invoice number", "Invoice date", "Taxable amount", "VAT amount"],
    dateColumn: 1,
    rows: feeInvoiceRows,
  },
];
