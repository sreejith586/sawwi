import { parseAmount } from "@/lib/pdf/text";
import { settlementDate } from "@/lib/automation/settlements/parse";

// A courier's COD remittance report → one batch per remittance (D-74, D-76). Columns are found by
// name, so Aramex, SMSA, J&T, Quiqup, iMile and the rest read without set-up. Pure functions.

export type ParsedParcel = { awb: string; orderRef: string; collected: number; fee: number; vat: number; net: number; row: number };
export type ParsedRemittance = { batchId: string; courier: string; remittanceDate: string; currency: string; statedNet: number | null; parcels: ParsedParcel[]; problems: string[] };

export class RemittanceParseError extends Error {}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const r2 = (n: number) => Math.round(n * 100) / 100;
const cents = (n: number) => Math.round(n * 100);

function find(headers: string[], names: string[]): number {
  const h = headers.map(norm);
  for (const n of names) {
    const i = h.indexOf(norm(n));
    if (i >= 0) return i;
  }
  return -1;
}

const COLS = {
  awb: ["awb / tracking number", "awb", "awb number", "awb no", "tracking number", "tracking no", "tracking", "waybill", "waybill number", "shipment number", "consignment number", "airway bill"],
  order: ["order id", "order reference", "order ref", "order number", "order no", "shipper reference", "shipper ref", "customer reference", "reference", "ref", "merchant reference"],
  collected: ["collected", "cod collected", "amount collected", "collected amount", "cod amount", "cod value", "cod", "cash collected"],
  fee: ["cod fee", "cod charges", "cod charge", "collection fee", "service charge", "service fee", "fee", "charges"],
  vat: ["vat on fee", "vat on cod fee", "vat on charges", "vat", "vat amount", "tax"],
  net: ["net remitted", "net amount remitted", "amount remitted", "remitted amount", "net payable", "net amount", "net", "payable"],
  batch: ["remittance / batch id", "remittance id", "remittance number", "remittance no", "remittance reference", "batch id", "batch number", "batch", "payment reference", "transfer reference"],
  date: ["remitted date", "remittance date", "payment date", "transfer date", "paid date", "date"],
  currency: ["currency", "currency code"],
  courier: ["courier", "carrier", "courier name"],
};

const COURIERS: [RegExp, string][] = [
  [/aramex|\barx\b/i, "Aramex"],
  [/smsa/i, "SMSA"],
  [/j\s?&\s?t|jnt|jt express/i, "J&T"],
  [/quiqup/i, "Quiqup"],
  [/imile/i, "iMile"],
  [/naqel/i, "Naqel"],
  [/\bdhl\b/i, "DHL"],
  [/shipa/i, "Shipa"],
  [/emirates post|\bepg\b/i, "Emirates Post"],
];
export function guessCourier(...hints: string[]): string {
  for (const h of hints) for (const [re, name] of COURIERS) if (re.test(h)) return name;
  return "Courier";
}

const amount = (raw: string | undefined): number | undefined => {
  const s = (raw ?? "").trim();
  if (!s) return undefined;
  const n = parseAmount(s) ?? (/^-?\d+(\.\d+)?$/.test(s) ? Number(s) : undefined);
  return n === undefined || !Number.isFinite(n) ? undefined : n;
};

/** VAT on a fee, when the report gives net but not VAT: the difference, if it's a standard GCC rate of the fee (D-76). */
function inferVat(collected: number, fee: number, net: number): number | undefined {
  const diff = r2(collected - fee - net);
  if (cents(diff) === 0) return 0;
  for (const rate of [5, 10, 15]) if (Math.abs(cents(diff) - cents((fee * rate) / 100)) <= 1) return diff;
  return undefined;
}

export function parseRemittances(table: { headers: string[]; rows: string[][] }, fileName = ""): ParsedRemittance[] {
  const H = table.headers;
  const col = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, find(H, names)])) as Record<keyof typeof COLS, number>;
  if (col.awb < 0 && col.order < 0) throw new RemittanceParseError("No AWB / tracking number or order reference column found. Upload the courier's COD remittance report.");
  if (col.collected < 0 && col.net < 0) throw new RemittanceParseError("No collected or net remitted amount column found.");
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");

  const batches = new Map<string, ParsedRemittance>();
  table.rows.forEach((r, idx) => {
    const awb = cell(r, col.awb);
    const orderRef = cell(r, col.order);
    if (!awb && !orderRef) return;
    // Totals rows ("Total", blank AWB with an amount) are left out.
    if (/^(sub)?total/i.test(awb || orderRef)) return;
    const date = settlementDate(cell(r, col.date));
    const batchId = cell(r, col.batch) || `${guessCourier(cell(r, col.courier), fileName)}-${date || "batch"}`;
    let b = batches.get(batchId);
    if (!b) {
      b = { batchId, courier: guessCourier(cell(r, col.courier), fileName, batchId), remittanceDate: date, currency: cell(r, col.currency).toUpperCase(), statedNet: null, parcels: [], problems: [] };
      batches.set(batchId, b);
    }
    if (date && (!b.remittanceDate || date > b.remittanceDate)) b.remittanceDate = date;
    b.currency ||= cell(r, col.currency).toUpperCase();

    const fee = Math.abs(amount(cell(r, col.fee)) ?? 0);
    const vatGiven = amount(cell(r, col.vat));
    const netGiven = amount(cell(r, col.net));
    const collectedGiven = amount(cell(r, col.collected));
    const collected = collectedGiven ?? r2((netGiven ?? 0) + fee + Math.abs(vatGiven ?? 0));
    let vat = vatGiven !== undefined ? Math.abs(vatGiven) : undefined;
    if (vat === undefined && netGiven !== undefined) {
      vat = inferVat(collected, fee, netGiven);
      if (vat === undefined) b.problems.push(`${awb || orderRef}: collected ${collected.toFixed(2)} − fee ${fee.toFixed(2)} isn't the net ${netGiven.toFixed(2)}.`);
    }
    const net = netGiven ?? r2(collected - fee - (vat ?? 0));
    if (netGiven !== undefined) b.statedNet = r2((b.statedNet ?? 0) + netGiven);
    b.parcels.push({ awb, orderRef, collected: r2(collected), fee: r2(fee), vat: r2(vat ?? 0), net: r2(net), row: idx + 2 });
  });
  const out = [...batches.values()].filter((b) => b.parcels.length);
  if (out.length === 0) throw new RemittanceParseError("No parcels found in this remittance report.");
  return out;
}
