// Made-up counterpart files for local demos (D-31): the other side of each reconciliation that
// the mock Business Central company and the mock Magento store can't provide themselves (a card
// gateway, Tabby, the courier, the warehouse, the bank). Rows refer to the mock documents
// (orders 000000101…, invoices SI-31xx), so a demo run reconciles end to end, and each file
// plants a few exceptions. October 2026, AED. Nothing here is real.

import { FINANCE_FILES } from "./finance-files";
import { MARKETPLACE_FILES } from "./marketplace-files";

export type DemoFile = {
  id: string;
  label: string;
  description: string;
  /** "template/slot" hints, so the run page offers the file for the right slot. */
  slots: string[];
  headers: string[];
  /** Index of the date column used for the period filter, or -1 for undated tables. */
  dateColumn: number;
  rows: string[][];
};

const WEB_AND_B2B_FILES: DemoFile[] = [
  {
    id: "card_settlement",
    label: "Card gateway settlement",
    description: "Card captures and refunds for the demo store's card orders. Planted: one capture 5.00 short, one paid order not settled, one capture with no order.",
    slots: ["web-orders-vs-gateway/gateway"],
    headers: ["Merchant order reference", "Transaction ID", "Type", "Transaction date", "Gross amount", "Gateway fee", "Net settled", "Payout / batch ID", "Currency"],
    dateColumn: 3,
    rows: [
      ["000000101", "ch_3Q101", "capture", "2026-10-01", "495.00", "14.36", "480.64", "po_1029", "AED"],
      ["000000103", "ch_3Q103", "capture", "2026-10-04", "305.00", "8.85", "296.15", "po_1029", "AED"],
      ["000000103", "re_3Q103", "refund", "2026-10-08", "-305.00", "0.00", "-305.00", "po_1105", "AED"],
      ["000000106", "ch_3Q106", "capture", "2026-10-12", "484.00", "14.04", "469.96", "po_1105", "AED"],
      ["000000106", "re_3Q106", "refund", "2026-10-19", "-199.00", "0.00", "-199.00", "po_1119", "AED"],
      ["000000108", "ch_3Q108", "capture", "2026-10-21", "240.00", "6.96", "233.04", "po_1119", "AED"], // order total 245.00
      ["000000199", "ch_3Q199", "capture", "2026-10-28", "150.00", "4.35", "145.65", "po_1126", "AED"], // no such order
      // 000000110 (paid by card on 31 Oct) is not in the settlement yet.
    ],
  },
  {
    id: "bnpl_settlement",
    label: "Tabby settlement",
    description: "Tabby captures and payouts for the demo store's pay-later orders. Planted: one shipped order Tabby never captured.",
    slots: ["web-bnpl/bnpl"],
    headers: ["Merchant order reference", "Type", "Captured amount", "Merchant fee", "VAT on fee", "Net settled", "Payout date"],
    dateColumn: 6,
    rows: [
      ["000000104", "capture", "840.00", "37.80", "1.89", "800.31", "2026-10-14"],
      // 000000109 (Tabby, 26 Oct) was never captured.
    ],
  },
  {
    id: "courier_cod_status",
    label: "Courier COD delivery status",
    description: "The courier's delivery report for the demo store's cash-on-delivery parcels. Planted: a cancelled order the courier marked delivered.",
    slots: ["web-cod-remittance/courier_status"],
    headers: ["AWB / tracking number", "Order ID", "Delivery status", "Delivered date", "COD amount to collect"],
    dateColumn: 3,
    rows: [
      ["4410023302", "000000102", "Delivered", "2026-10-04", "229.00"],
      ["4410023307", "000000107", "Delivered", "2026-10-18", "430.00"],
      ["4410023399", "000000105", "Delivered", "2026-10-11", "160.00"], // order 105 was cancelled in the store
    ],
  },
  {
    id: "courier_cod_remittance",
    label: "Courier COD remittance",
    description: "Cash the courier collected and paid over. Planted: one parcel collected 10.00 short, one delivered parcel not remitted.",
    slots: ["web-cod-remittance/remittance"],
    headers: ["AWB / tracking number", "Remittance / batch ID", "Remitted date", "Collected", "COD fee", "Net remitted"],
    dateColumn: 2,
    rows: [
      ["4410023302", "RMT-2026-041", "2026-10-09", "229.00", "5.00", "224.00"],
      ["4410023307", "RMT-2026-044", "2026-10-23", "420.00", "5.00", "415.00"], // 430 to collect
    ],
  },
  {
    id: "courier_freight_invoice",
    label: "Courier freight invoice",
    description: "The courier's monthly freight bill for the demo store's shipments. Planted: one parcel billed at a heavier weight, one AWB billed twice, one AWB that isn't ours.",
    slots: ["web-courier-freight/freight_invoice"],
    headers: ["AWB / tracking number", "Charged weight (kg)", "Zone", "Freight charge", "Surcharges", "RTO charge"],
    dateColumn: -1,
    rows: [
      ["4410023301", "2.00", "UAE-DXB", "28.00", "2.00", "0.00"], // declared 1.00 kg
      ["4410023302", "1.00", "UAE-DXB", "18.00", "2.00", "0.00"],
      ["4410023302", "1.00", "UAE-DXB", "18.00", "2.00", "0.00"], // billed twice
      ["290118830", "0.50", "UAE-AUH", "16.00", "2.00", "0.00"],
      ["4410023304", "1.50", "UAE-SHJ", "22.00", "2.00", "0.00"],
      ["4410023305", "1.50", "UAE-SHJ", "22.00", "2.00", "0.00"],
      ["290118836", "1.50", "UAE-AUH", "24.00", "2.00", "0.00"],
      ["4410023307", "1.00", "UAE-DXB", "18.00", "2.00", "0.00"],
      ["4410029999", "3.00", "UAE-RAK", "36.00", "2.00", "0.00"], // not one of our shipments
    ],
  },
  {
    id: "courier_rate_card",
    label: "Courier rate card",
    description: "The demo store's contracted courier rates by zone and weight slab.",
    slots: ["web-courier-freight/rate_card"],
    headers: ["Zone", "Weight slab", "Rate"],
    dateColumn: -1,
    rows: [
      ["UAE-DXB", "0-1 kg", "18.00"],
      ["UAE-DXB", "1-2 kg", "24.00"],
      ["UAE-AUH", "0-1 kg", "16.00"],
      ["UAE-AUH", "1-2 kg", "22.00"],
      ["UAE-SHJ", "0-1 kg", "18.00"],
      ["UAE-SHJ", "1-2 kg", "22.00"],
      ["UAE-RAK", "0-1 kg", "20.00"],
      ["UAE-RAK", "1-2 kg", "26.00"],
    ],
  },
  {
    id: "warehouse_returns",
    label: "Warehouse returns received",
    description: "Returns the demo store's warehouse booked in. Planted: a refund with no return received, and a return with no refund.",
    slots: ["web-refunds-vs-returns/received"],
    headers: ["Order ID", "SKU", "Quantity", "Received date", "Condition"],
    dateColumn: 3,
    rows: [
      ["000000106", "SND-42", "1.00", "2026-10-17", "Good"],
      ["000000104", "ABY-BLK-M", "1.00", "2026-10-25", "Good"], // returned, not refunded yet
      // 000000103 (OUD-50) was refunded but never came back.
    ],
  },
  {
    id: "bank_receipts",
    label: "Bank receipts",
    description: "Customer payments on the demo company's bank statement. Planted: one invoice paid short, one receipt nobody can apply.",
    slots: ["b2b-cash-application/receipts"],
    headers: ["Receipt date", "Customer / payer", "Reference / narration", "Amount received", "Currency"],
    dateColumn: 0,
    rows: [
      ["2026-10-20", "Al Waha Hotels", "TT AL WAHA HOTELS INV SI-3101", "7350.00", "AED"],
      ["2026-10-15", "Desert Rose Contracting", "PAYMENT SI-3103 DESERT ROSE", "2000.00", "AED"], // invoice 3990.00
      ["2026-10-29", "Marina Facilities Management", "TT REF 88213 MARINA FM", "5000.00", "AED"], // no invoice reference
    ],
  },
];

export const DEMO_FILES: DemoFile[] = [...WEB_AND_B2B_FILES, ...MARKETPLACE_FILES, ...FINANCE_FILES];

export const demoFileById = (id: string) => DEMO_FILES.find((f) => f.id === id);
