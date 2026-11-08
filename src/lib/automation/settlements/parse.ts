import { parseAmount } from "@/lib/pdf/text";
import { isoDate } from "@/lib/automation/purchase-invoices/draft";

// A settlement report (any parsed table: CSV, Excel or PDF) → one summary per settlement (D-70).
// Two layouts: "long" (one row per amount, with its type and description, like Amazon's flat file
// V2) and "wide" (one row per order or transaction, a column per amount type). Pure functions.

export type SettlementCategory = {
  /** Stable within a marketplace: the name the marketplace gives this amount. */
  key: string;
  amount: number;
  rows: number;
};

export type ParsedSettlement = {
  settlementId: string;
  marketplace: string;
  format: "long" | "wide";
  periodStart: string;
  periodEnd: string;
  depositDate: string;
  currency: string;
  /** What the report says was paid out, when it says. */
  statedPayout: number | null;
  categories: SettlementCategory[];
  rows: number;
  orders: number;
};

export class SettlementParseError extends Error {}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const r2 = (n: number) => Math.round(n * 100) / 100;

/** "2026-10-14 08:00:00 UTC", "14.10.2026 08:00:00 UTC", "14/10/2026" → ISO; "" if not a date. */
export function settlementDate(raw: string | undefined): string {
  const s = (raw ?? "").trim();
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return isoDate(iso[1]);
  return isoDate(s.split(/[ T]/)[0]);
}

const amount = (raw: string | undefined): number | undefined => {
  const s = (raw ?? "").trim();
  if (!s) return undefined;
  const n = parseAmount(s) ?? (/^-?\d+(\.\d+)?$/.test(s) ? Number(s) : undefined);
  return n === undefined || !Number.isFinite(n) ? undefined : n;
};

function find(headers: string[], ...names: string[]): number {
  const h = headers.map(norm);
  for (const n of names) {
    const i = h.indexOf(norm(n));
    if (i >= 0) return i;
  }
  return -1;
}

const MARKETPLACES: [RegExp, string][] = [
  [/amazon\.?sa|amazon sa|\bksa\b/i, "Amazon.sa"],
  [/amazon\.?ae|amazon ae/i, "Amazon.ae"],
  [/amazon/i, "Amazon"],
  [/noon/i, "Noon"],
  [/namshi/i, "Namshi"],
  [/trendyol/i, "Trendyol"],
];
export function guessMarketplace(...hints: string[]): string {
  for (const h of hints) for (const [re, name] of MARKETPLACES) if (re.test(h)) return name;
  return "Marketplace";
}

/** Sums amounts per settlement and category. */
type Meta = Partial<ParsedSettlement> & { periodStartFromRows?: string; periodEndFromRows?: string };

/** Earliest and latest dates seen on a settlement's rows, for when the report states no period. */
function seen(m: Meta, d: string) {
  if (!d) return;
  if (!m.periodStartFromRows || d < m.periodStartFromRows) m.periodStartFromRows = d;
  if (!m.periodEndFromRows || d > m.periodEndFromRows) m.periodEndFromRows = d;
}

class Acc {
  map = new Map<string, { cats: Map<string, SettlementCategory>; orders: Set<string>; rows: number; meta: Meta }>();
  get(id: string) {
    let s = this.map.get(id);
    if (!s) this.map.set(id, (s = { cats: new Map(), orders: new Set(), rows: 0, meta: {} }));
    return s;
  }
  add(id: string, key: string, value: number) {
    const s = this.get(id);
    const c = s.cats.get(key) ?? { key, amount: 0, rows: 0 };
    c.amount += value;
    c.rows++;
    s.cats.set(key, c);
  }
}

export function parseSettlements(table: { headers: string[]; rows: string[][] }, fileName = ""): ParsedSettlement[] {
  const H = table.headers;
  const idCol = find(H, "settlement-id", "settlement id", "settlement number", "statement id", "statement number", "payout id", "settlement reference");
  if (idCol < 0) throw new SettlementParseError("No settlement ID column found. Upload the settlement report as the marketplace exports it.");
  const descCol = find(H, "amount-description", "amount description", "description");
  const typeCol = find(H, "amount-type", "amount type");
  const amountCol = find(H, "amount");
  const long = descCol >= 0 && amountCol >= 0 && (typeCol >= 0 || find(H, "transaction-type", "transaction type") >= 0);
  const txCol = find(H, "transaction-type", "transaction type", "type");
  const orderCol = find(H, "order-id", "order id", "order number", "order nr", "order_nr", "order");
  const currencyCol = find(H, "currency", "currency code");
  const marketCol = find(H, "marketplace-name", "marketplace name", "marketplace", "channel");
  const startCol = find(H, "settlement-start-date", "settlement start date", "period start", "start date");
  const endCol = find(H, "settlement-end-date", "settlement end date", "period end", "end date");
  const depositCol = find(H, "deposit-date", "deposit date", "payout date", "settlement date", "paid on", "transfer date");
  const totalCol = find(H, "total-amount", "total amount", "payout amount", "settlement total");
  const netCol = find(H, "net amount paid", "net amount", "net paid", "net payout", "amount paid", "net");
  const postedCol = find(H, "posted-date", "posted date", "date", "transaction date");
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");

  const acc = new Acc();
  const firstHint = { market: "", currency: "" };

  if (long) {
    for (const r of table.rows) {
      const id = cell(r, idCol);
      if (!id) continue;
      const s = acc.get(id);
      const total = amount(cell(r, totalCol));
      // The summary row: dates and the payout, no amount line.
      if (total !== undefined && !cell(r, descCol)) {
        s.meta.statedPayout = r2(total);
        s.meta.depositDate ||= settlementDate(cell(r, depositCol));
        s.meta.periodStart ||= settlementDate(cell(r, startCol));
        s.meta.periodEnd ||= settlementDate(cell(r, endCol));
        s.meta.currency ||= cell(r, currencyCol).toUpperCase();
        continue;
      }
      const value = amount(cell(r, amountCol));
      if (value === undefined) continue;
      const tx = cell(r, txCol);
      const type = cell(r, typeCol);
      const desc = cell(r, descCol);
      // A refunded principal and a sold one are different amounts: the transaction type is part of the name for refunds.
      const refund = /refund|return|chargeback/i.test(tx);
      const key = `${refund ? "Refund · " : ""}${type && type !== desc ? `${type} · ` : ""}${desc}`.trim();
      acc.add(id, key, value);
      s.rows++;
      const order = cell(r, orderCol);
      if (order) s.orders.add(order);
      s.meta.currency ||= cell(r, currencyCol).toUpperCase();
      s.meta.marketplace ||= cell(r, marketCol);
      seen(s.meta, settlementDate(cell(r, postedCol)));
    }
  } else {
    // Wide: every numeric column that isn't an ID, date, quantity or the net paid is an amount category.
    const known = new Set([idCol, orderCol, currencyCol, marketCol, startCol, endCol, depositCol, totalCol, netCol, postedCol, txCol].filter((i) => i >= 0));
    const skip = /\b(sku|asin|quantity|qty|units|id|number|code|rate|percent|pct)\b|%/i;
    const sample = table.rows.slice(0, 200);
    const amountCols = H.map((h, i) => i).filter((i) => !known.has(i) && !skip.test(H[i]) && sample.some((r) => amount(cell(r, i)) !== undefined) && sample.every((r) => !cell(r, i) || amount(cell(r, i)) !== undefined));
    if (amountCols.length === 0) throw new SettlementParseError("No amount columns found in this settlement report.");
    for (const r of table.rows) {
      const id = cell(r, idCol);
      if (!id) continue;
      const s = acc.get(id);
      const tx = cell(r, txCol);
      const refund = /refund|return|chargeback/i.test(tx);
      for (const i of amountCols) {
        const value = amount(cell(r, i));
        if (value === undefined || value === 0) continue;
        acc.add(id, `${refund ? "Refund · " : ""}${H[i].trim()}`, value);
      }
      s.rows++;
      const net = amount(cell(r, netCol));
      if (net !== undefined) s.meta.statedPayout = r2((s.meta.statedPayout ?? 0) + net);
      const order = cell(r, orderCol);
      if (order) s.orders.add(order);
      s.meta.currency ||= cell(r, currencyCol).toUpperCase();
      s.meta.marketplace ||= cell(r, marketCol);
      const d = settlementDate(cell(r, depositCol)) || settlementDate(cell(r, postedCol));
      if (d && (!s.meta.depositDate || d > s.meta.depositDate)) s.meta.depositDate = d;
      seen(s.meta, d);
    }
  }

  const out: ParsedSettlement[] = [];
  for (const [settlementId, s] of acc.map) {
    if (s.cats.size === 0) continue;
    const m = s.meta;
    firstHint.market ||= m.marketplace ?? "";
    firstHint.currency ||= m.currency ?? "";
    out.push({
      settlementId,
      marketplace: guessMarketplace(m.marketplace ?? "", fileName),
      format: long ? "long" : "wide",
      periodStart: m.periodStart || m.periodStartFromRows || "",
      periodEnd: m.periodEnd || m.periodEndFromRows || "",
      depositDate: m.depositDate || m.periodEnd || m.periodEndFromRows || "",
      currency: m.currency || "",
      statedPayout: m.statedPayout ?? null,
      categories: [...s.cats.values()].map((c) => ({ ...c, amount: r2(c.amount) })).filter((c) => c.amount !== 0 || c.rows > 0),
      rows: s.rows,
      orders: s.orders.size,
    });
  }
  if (out.length === 0) throw new SettlementParseError("No settlement lines found in this file.");
  // A file with one marketplace name on some rows only: use it for all.
  for (const s of out) if (s.marketplace === "Marketplace" && firstHint.market) s.marketplace = guessMarketplace(firstHint.market, fileName);
  for (const s of out) if (!s.currency && firstHint.currency) s.currency = firstHint.currency;
  return out;
}
