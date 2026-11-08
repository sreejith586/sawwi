import Papa from "papaparse";
import { MARKETPLACE_FILES } from "@/lib/connectors/mock/marketplace-files";

// Sample settlement reports for the demo store's Automation section (D-73). Invented data only:
// the generic marketplace's October settlements (the same file the reconciliation demo uses),
// and an Amazon-style settlement flat file (V2 layout) with one category the dictionary doesn't
// know, so the demo shows classifying it once.

export type SettlementSample = { id: string; title: string; shows: string; fileName: string; text: () => string };

const r2 = (n: number) => Math.round(n * 100) / 100;

const AMAZON_HEADERS = [
  "settlement-id", "settlement-start-date", "settlement-end-date", "deposit-date", "total-amount", "currency", "transaction-type", "order-id",
  "merchant-order-id", "adjustment-id", "shipment-id", "marketplace-name", "amount-type", "amount-description", "amount", "fulfillment-id",
  "posted-date", "posted-date-time", "order-item-code", "merchant-order-item-id", "merchant-adjustment-item-id", "sku", "quantity-purchased", "promotion-id",
];

type AmzLine = { tx: string; order: string; type: string; desc: string; amount: number; date: string; sku?: string; qty?: number };

/** An invented Amazon.ae settlement: four orders, a refund, FBA fees with VAT, storage, ads and a liquidation. */
function amazonText(): string {
  const id = "24681357911";
  const lines: AmzLine[] = [];
  const order = (o: string, sku: string, qty: number, price: number, date: string) => {
    const principal = r2(price * qty);
    const referral = r2(-principal * 0.12);
    const fba = r2(-9.5 * qty);
    lines.push(
      { tx: "Order", order: o, type: "ItemPrice", desc: "Principal", amount: principal, date, sku, qty },
      { tx: "Order", order: o, type: "ItemFees", desc: "Commission", amount: referral, date, sku, qty },
      { tx: "Order", order: o, type: "ItemFees", desc: "FBAPerUnitFulfillmentFee", amount: fba, date, sku, qty },
      { tx: "Order", order: o, type: "ItemFees", desc: "Tax on fees", amount: r2((referral + fba) * 0.05), date, sku, qty },
    );
  };
  order("402-1111111-0000001", "ABY-BLK-M", 1, 420, "2026-10-03");
  order("402-1111111-0000002", "OUD-50", 2, 285, "2026-10-06");
  order("402-1111111-0000003", "MAT-01", 3, 75, "2026-10-09");
  order("402-1111111-0000004", "SND-42", 1, 199, "2026-10-11");
  // A refund of order 4: principal back, part of the commission returned.
  lines.push(
    { tx: "Refund", order: "402-1111111-0000004", type: "ItemPrice", desc: "Principal", amount: -199, date: "2026-10-13", sku: "SND-42", qty: 1 },
    { tx: "Refund", order: "402-1111111-0000004", type: "ItemFees", desc: "Commission", amount: 19.1, date: "2026-10-13", sku: "SND-42", qty: 1 },
    { tx: "Refund", order: "402-1111111-0000004", type: "ItemFees", desc: "RefundCommission", amount: -4.78, date: "2026-10-13", sku: "SND-42", qty: 1 },
    { tx: "other-transaction", order: "", type: "other-transaction", desc: "Storage Fee", amount: -36.4, date: "2026-10-14" },
    { tx: "other-transaction", order: "", type: "other-transaction", desc: "Cost of Advertising", amount: -150, date: "2026-10-14" },
    { tx: "other-transaction", order: "", type: "other-transaction", desc: "Liquidations", amount: 22.5, date: "2026-10-14" },
  );
  const total = r2(lines.reduce((a, l) => a + l.amount, 0));
  const blank = AMAZON_HEADERS.map(() => "");
  const summary = [...blank];
  Object.assign(summary, { 0: id, 1: "01.10.2026 00:00:00 UTC", 2: "15.10.2026 00:00:00 UTC", 3: "17.10.2026 00:00:00 UTC", 4: total.toFixed(2), 5: "AED" });
  const rows = [summary, ...lines.map((l) => {
    const r = [...blank];
    Object.assign(r, { 0: id, 6: l.tx, 7: l.order, 11: "Amazon.ae", 12: l.type, 13: l.desc, 14: l.amount.toFixed(2), 16: `${l.date.split("-").reverse().join(".")}`, 21: l.sku ?? "", 22: l.qty ? String(l.qty) : "" });
    return r;
  })];
  return Papa.unparse({ fields: AMAZON_HEADERS, data: rows }, { delimiter: "\t" });
}

function genericText(): string {
  const f = MARKETPLACE_FILES.find((x) => x.id === "mp_settlement")!;
  return Papa.unparse({ fields: f.headers, data: f.rows });
}

export const SETTLEMENT_SAMPLES: SettlementSample[] = [
  {
    id: "generic-oct",
    title: "Generic marketplace · two October settlements",
    shows: "A wide report (a column per fee): two settlements in one file, every column classified by the dictionary.",
    fileName: "marketplace-settlements-2026-10.csv",
    text: genericText,
  },
  {
    id: "amazon-ae-24681357911",
    title: "Amazon.ae · settlement 24681357911",
    shows: "Amazon's flat file layout, with a refund, FBA fees, VAT on fees, storage, ads and one category (Liquidations) to classify once.",
    fileName: "amazon-ae-settlement-24681357911.txt",
    text: amazonText,
  },
];

export const settlementSample = (id: string) => SETTLEMENT_SAMPLES.find((s) => s.id === id);
