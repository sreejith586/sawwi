import Papa from "papaparse";
import { BUCKETS, bucketLabel, classify, type Bucket } from "./buckets";
import type { ParsedSettlement } from "./parse";

// A settlement as the user reviews it, and the journal it becomes (D-70). Pure, browser-safe.
//
// Signs: a settlement amount is from the seller's side (+ paid to the seller, − deducted).
// A journal line's amount is + for a debit and − for a credit, as in Business Central. So each
// category's line is −amount (sales credit income, fees debit expense) and the payout line is
// +payout (debit the clearing or bank account). They balance when the categories add up to the payout.

export type SettlementCategoryDraft = { key: string; amount: number; rows: number; bucket: Bucket | null; classifiedBy?: "dictionary" | "memory" | "user" };

export type SettlementDraft = {
  settlementId: string;
  marketplace: string;
  periodStart: string;
  periodEnd: string;
  /** The journal's posting date. */
  postingDate: string;
  currency: string;
  statedPayout: number | null;
  categories: SettlementCategoryDraft[];
  rows: number;
  orders: number;
};

/** Per workspace: where each bucket goes, and how sales VAT is treated. */
export type SettlementSettings = {
  /** Bucket (or "payout") → G/L account number. */
  accounts: Partial<Record<Bucket | "payout", string>>;
  /** Account number → name, for showing; filled from the ERP when there is one. */
  accountNames: Record<string, string>;
  /** Marketplace → category name → bucket, remembered from the user's choices. */
  categories: Record<string, Record<string, Bucket>>;
  /** Percent, when sales amounts include VAT and Sawwi should split output VAT out; null when not. */
  salesVatRate: number | null;
  /** The ERP's general journal batch to push to. */
  journalId: string | null;
};

export const emptySettings = (): SettlementSettings => ({ accounts: {}, accountNames: {}, categories: {}, salesVatRate: null, journalId: null });

const r2 = (n: number) => Math.round(n * 100) / 100;
const cents = (n: number) => Math.round(n * 100);

export function draftFromParsed(p: ParsedSettlement, settings: SettlementSettings): SettlementDraft {
  const remembered = settings.categories[p.marketplace] ?? {};
  return {
    settlementId: p.settlementId,
    marketplace: p.marketplace,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    postingDate: p.depositDate || p.periodEnd,
    currency: p.currency,
    statedPayout: p.statedPayout,
    rows: p.rows,
    orders: p.orders,
    categories: p.categories
      .map((c) => {
        const mem = remembered[c.key];
        const dict = classify(c.key.replace(/^Refund · /, ""), c.key.startsWith("Refund · ") ? "Refund" : "");
        return { ...c, bucket: mem ?? dict ?? null, classifiedBy: mem ? ("memory" as const) : dict ? ("dictionary" as const) : undefined };
      })
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
  };
}

export type JournalLine = { account: string; accountName: string; bucket: Bucket | "payout"; description: string; amount: number };
export type Check = { id: string; label: string; ok: boolean; detail: string };
export type JournalReview = { lines: JournalLine[]; debits: number; credits: number; payout: number; checks: Check[]; blockers: string[]; warnings: string[] };

const money = (n: number, ccy: string) => `${ccy ? `${ccy} ` : ""}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const VAT_SPLIT: Bucket[] = ["sales", "shipping", "promotions", "refunds"];

/** The journal: one line per bucket used (categories summed), output VAT split out if set, and the payout line. */
export function buildJournal(d: SettlementDraft, s: SettlementSettings): JournalReview {
  const ccy = d.currency;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const checks: Check[] = [];

  const unclassified = d.categories.filter((c) => !c.bucket);
  for (const c of unclassified) blockers.push(`Classify "${c.key}" (${money(c.amount, ccy)}).`);
  const posted = d.categories.filter((c) => c.bucket && c.bucket !== "ignore");
  const sum = r2(d.categories.filter((c) => c.bucket !== "ignore").reduce((a, c) => a + c.amount, 0));
  const payout = d.statedPayout ?? sum;
  // Reports round each row's amounts on their own, so a few cents can separate the parts from the
  // stated payout: up to a cent per row is booked as rounding; more blocks approval.
  let rounding = 0;
  if (d.statedPayout !== null) {
    const diff = cents(d.statedPayout) - cents(sum);
    const ok = diff === 0 || Math.abs(diff) <= Math.max(1, d.rows);
    rounding = ok ? diff / 100 : 0;
    checks.push({
      id: "adds_up",
      label: "Amounts add up to the payout",
      ok,
      detail:
        diff === 0
          ? `${d.categories.length} amount types add up to ${money(d.statedPayout, ccy)}.`
          : ok
            ? `The amounts add up to ${money(sum, ccy)}; the payout is ${money(d.statedPayout, ccy)}. The ${money(Math.abs(rounding), ccy)} difference is rounding on the report's rows, booked to Other fees.`
            : `The amounts add up to ${money(sum, ccy)}, but the payout is ${money(d.statedPayout, ccy)}: a line may be missing from the file, or classified as "Not posted".`,
    });
    if (!ok) blockers.push(checks[checks.length - 1].detail);
    else if (diff !== 0) warnings.push(checks[checks.length - 1].detail);
  } else warnings.push("The report states no payout total, so the payout is the sum of its amounts. Check it against the bank.");

  // Sum per bucket, then split output VAT out of VAT-inclusive buckets when asked.
  const byBucket = new Map<Bucket, { amount: number; keys: string[] }>();
  for (const c of posted) {
    const b = byBucket.get(c.bucket!) ?? { amount: 0, keys: [] };
    b.amount += c.amount;
    b.keys.push(c.key);
    byBucket.set(c.bucket!, b);
  }
  if (rounding) {
    const b = byBucket.get("other_fees") ?? { amount: 0, keys: [] };
    b.amount += rounding;
    b.keys.push("Rounding");
    byBucket.set("other_fees", b);
  }
  if (s.salesVatRate) {
    if (byBucket.has("sales_vat")) warnings.push("The report already shows output VAT, so it isn't split out of sales again.");
    else {
      let vat = 0;
      for (const b of VAT_SPLIT) {
        const x = byBucket.get(b);
        if (!x) continue;
        const part = r2((x.amount * s.salesVatRate) / (100 + s.salesVatRate));
        x.amount -= part;
        vat += part;
      }
      if (vat) byBucket.set("sales_vat", { amount: vat, keys: [`${s.salesVatRate}% of sales, shipping, promotions and refunds`] });
    }
  }

  const name = (acct: string) => s.accountNames[acct] ?? "";
  const lines: JournalLine[] = [];
  for (const def of BUCKETS) {
    const x = byBucket.get(def.id);
    if (!x || cents(x.amount) === 0) continue;
    const account = s.accounts[def.id] ?? "";
    if (!account) blockers.push(`Choose the G/L account for ${def.label}.`);
    lines.push({ account, accountName: name(account), bucket: def.id, description: `${d.marketplace} ${d.settlementId} ${def.label}`.slice(0, 100), amount: r2(-x.amount) });
  }
  const payAccount = s.accounts.payout ?? "";
  if (!payAccount) blockers.push("Choose the account the payout goes to (marketplace clearing or bank).");
  lines.push({ account: payAccount, accountName: name(payAccount), bucket: "payout", description: `${d.marketplace} ${d.settlementId} payout`.slice(0, 100), amount: r2(payout) });

  // Rounding from the VAT split, if any, so the journal balances to the cent.
  const off = lines.reduce((a, l) => a + cents(l.amount), 0);
  if (off !== 0 && Math.abs(off) <= posted.length + 1 && s.salesVatRate) {
    const vatLine = lines.find((l) => l.bucket === "sales_vat");
    if (vatLine) vatLine.amount = r2(vatLine.amount - off / 100);
  }
  const debits = r2(lines.filter((l) => l.amount > 0).reduce((a, l) => a + l.amount, 0));
  const credits = r2(-lines.filter((l) => l.amount < 0).reduce((a, l) => a + l.amount, 0));
  // Until every category is classified the journal is incomplete, so balance isn't checked yet.
  if (unclassified.length === 0) {
    const balanced = cents(debits) === cents(credits);
    checks.push({ id: "balanced", label: "Debits = credits", ok: balanced, detail: balanced ? `${money(debits, ccy)} each side.` : `Debits ${money(debits, ccy)}, credits ${money(credits, ccy)}.` });
    if (!balanced && !blockers.some((b) => b.includes("add up"))) blockers.push(`The journal doesn't balance: debits ${money(debits, ccy)}, credits ${money(credits, ccy)}.`);
  }

  if (!d.postingDate) blockers.push("Set the posting date.");
  if (!d.settlementId) blockers.push("The settlement ID is missing.");
  if (payout < 0) warnings.push("This settlement is negative: the marketplace owes nothing and may debit you.");
  return { lines, debits, credits, payout, checks, blockers, warnings };
}

/** The document number in the ERP: the settlement ID, at most 20 characters (Business Central's limit). */
export const documentNumber = (d: SettlementDraft) => d.settlementId.slice(0, 20);

export const CSV_HEADERS = ["Posting date", "Document no.", "External document no.", "Account type", "Account no.", "Account name", "Description", "Debit", "Credit", "Amount", "Currency"];

export function journalCsv(items: { draft: SettlementDraft; lines: JournalLine[] }[]): string {
  const rows = items.flatMap(({ draft, lines }) =>
    lines.map((l) => [
      draft.postingDate,
      documentNumber(draft),
      draft.marketplace,
      "G/L Account",
      l.account,
      l.accountName,
      l.description,
      l.amount > 0 ? String(l.amount) : "",
      l.amount < 0 ? String(-l.amount) : "",
      String(l.amount),
      draft.currency,
    ]),
  );
  return Papa.unparse({ fields: CSV_HEADERS, data: rows });
}

/** Cleans a draft from the browser: only the fields a user may change (buckets, posting date, marketplace). */
export function applyEdits(d: SettlementDraft, input: unknown): SettlementDraft | undefined {
  if (!input || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  const valid = new Set(BUCKETS.map((b) => b.id));
  const buckets = (o.buckets ?? {}) as Record<string, unknown>;
  const date = typeof o.postingDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.postingDate) ? o.postingDate : d.postingDate;
  return {
    ...d,
    postingDate: date,
    categories: d.categories.map((c) => {
      const b = buckets[c.key];
      if (typeof b === "string" && valid.has(b as Bucket) && b !== c.bucket) return { ...c, bucket: b as Bucket, classifiedBy: "user" as const };
      if (b === null) return { ...c, bucket: null, classifiedBy: undefined };
      return c;
    }),
  };
}

export { bucketLabel };
