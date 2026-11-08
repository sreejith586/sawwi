import Papa from "papaparse";
import type { ParsedRemittance } from "./parse";

// A COD remittance batch as the user reviews it, and what it becomes (D-74): one customer payment
// per parcel (applied to its invoice, or on account) and one general journal for the money side.
// Pure, browser-safe.

export type ParcelAction = "apply" | "on_account" | "exclude";
export type InvoiceState = "open" | "paid" | "none" | "unchecked";

export type ParcelDraft = {
  awb: string;
  orderRef: string;
  collected: number;
  fee: number;
  vat: number;
  net: number;
  invoiceNumber: string;
  customerNumber: string;
  /** What is still open on the invoice; null when unknown. */
  openAmount: number | null;
  invoiceState: InvoiceState;
  matchedBy?: "external_document" | "invoice_number" | "order_number";
  /** null until decided: Sawwi only decides when the parcel matches an open invoice. */
  action: ParcelAction | null;
  /** Set when the same AWB was remitted in another batch. */
  duplicateOf?: string;
};

export type RemittanceDraft = {
  batchId: string;
  courier: string;
  postingDate: string;
  currency: string;
  statedNet: number | null;
  parcels: ParcelDraft[];
  problems: string[];
};

export type CodSettings = {
  accounts: { bank?: string; clearing?: string; fees?: string; feeVat?: string };
  accountNames: Record<string, string>;
  /** Customer for cash with no invoice, put on account. */
  defaultCustomer: string;
  paymentJournalId: string | null;
  generalJournalId: string | null;
};

export const emptyCodSettings = (): CodSettings => ({ accounts: {}, accountNames: {}, defaultCustomer: "", paymentJournalId: null, generalJournalId: null });

const r2 = (n: number) => Math.round(n * 100) / 100;
const cents = (n: number) => Math.round(n * 100);
const money = (n: number, ccy: string) => `${ccy ? `${ccy} ` : ""}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function draftFromParsed(p: ParsedRemittance): RemittanceDraft {
  return {
    batchId: p.batchId,
    courier: p.courier,
    postingDate: p.remittanceDate,
    currency: p.currency,
    statedNet: p.statedNet,
    problems: p.problems,
    parcels: p.parcels.map((x) => ({ awb: x.awb, orderRef: x.orderRef, collected: x.collected, fee: x.fee, vat: x.vat, net: x.net, invoiceNumber: "", customerNumber: "", openAmount: null, invoiceState: "unchecked", action: "apply" })),
  };
}

export type Payment = { awb: string; orderRef: string; customerNumber: string; invoiceNumber: string; amount: number; description: string };
export type GlLine = { key: "bank" | "fees" | "feeVat" | "clearing"; account: string; accountName: string; description: string; amount: number };
export type Check = { id: string; label: string; ok: boolean; detail: string };
export type RemittanceReview = {
  payments: Payment[];
  gl: GlLine[];
  totals: { collected: number; fees: number; vat: number; net: number; applied: number; onAccount: number; leftOut: number };
  checks: Check[];
  blockers: string[];
  warnings: string[];
  /** Per parcel, what's notable: "short 10.00", "no invoice", … */
  flags: Record<string, string[]>;
};

const keyOf = (p: Pick<ParcelDraft, "awb" | "orderRef">) => p.awb || p.orderRef;

/** Payments, journal and checks. `erp`: invoices were looked up, so a parcel must have a decided action. */
export function reviewRemittance(d: RemittanceDraft, s: CodSettings, opts: { erp: boolean }): RemittanceReview {
  const ccy = d.currency;
  const blockers: string[] = [...d.problems];
  const warnings: string[] = [];
  const checks: Check[] = [];
  const flags: Record<string, string[]> = {};
  const flag = (p: ParcelDraft, f: string) => (flags[keyOf(p)] ??= []).push(f);

  const totals = { collected: 0, fees: 0, vat: 0, net: 0, applied: 0, onAccount: 0, leftOut: 0 };
  const payments: Payment[] = [];
  let lineOff = 0;
  for (const p of d.parcels) {
    totals.collected += p.collected;
    totals.fees += p.fee;
    totals.vat += p.vat;
    totals.net += p.net;
    if (cents(p.collected - p.fee - p.vat) !== cents(p.net)) lineOff++;
    if (p.duplicateOf) flag(p, `already remitted in ${p.duplicateOf}`);
    if (opts.erp) {
      if (p.invoiceState === "none") flag(p, "no posted invoice");
      if (p.invoiceState === "paid") flag(p, `invoice ${p.invoiceNumber} already paid`);
    }
    if (!p.action) {
      blockers.push(`${keyOf(p)} (order ${p.orderRef || "?"}): ${(flags[keyOf(p)] ?? ["needs a decision"]).join(", ")}. Apply, put on account, or leave out.`);
      continue;
    }
    if (p.action === "exclude") {
      totals.leftOut += p.collected;
      continue;
    }
    if (p.action === "apply") {
      if (opts.erp && (p.invoiceState !== "open" || !p.invoiceNumber)) {
        blockers.push(`${keyOf(p)}: there's no open invoice to apply to. Put it on account or leave it out.`);
        continue;
      }
      if (p.openAmount !== null && cents(p.collected) < cents(p.openAmount)) flag(p, `short ${money(r2(p.openAmount - p.collected), ccy)}: the rest stays open`);
      if (p.openAmount !== null && cents(p.collected) > cents(p.openAmount)) flag(p, `over ${money(r2(p.collected - p.openAmount), ccy)}: the excess stays on account`);
      totals.applied += p.collected;
    } else totals.onAccount += p.collected;
    const customer = p.customerNumber || (p.action === "on_account" ? s.defaultCustomer : "");
    if (opts.erp && !customer) blockers.push(`${keyOf(p)}: no customer to put it on. Set a default COD customer.`);
    payments.push({
      awb: p.awb,
      orderRef: p.orderRef,
      customerNumber: customer,
      invoiceNumber: p.action === "apply" ? p.invoiceNumber : "",
      amount: r2(-p.collected),
      description: `COD ${d.courier} ${p.awb || ""} order ${p.orderRef}`.replace(/\s+/g, " ").trim().slice(0, 100),
    });
  }
  for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] = r2(totals[k]);

  checks.push({
    id: "parcels",
    label: "Collected − fee − VAT = net, per parcel",
    ok: lineOff === 0,
    detail: lineOff === 0 ? `${d.parcels.length} parcels add up.` : `${lineOff} parcel${lineOff === 1 ? "" : "s"} don't add up.`,
  });
  if (lineOff) blockers.push(checks[0].detail);
  if (d.statedNet !== null) {
    const ok = cents(d.statedNet) === cents(totals.net);
    checks.push({ id: "batch", label: "Parcels add up to the amount remitted", ok, detail: ok ? `${money(totals.net, ccy)} remitted.` : `The parcels' net is ${money(totals.net, ccy)}, the report says ${money(d.statedNet, ccy)}.` });
    if (!ok) blockers.push(checks[checks.length - 1].detail);
  }
  if (totals.leftOut) warnings.push(`${money(totals.leftOut, ccy)} collected is left out: it stays in courier clearing until you deal with it.`);

  const name = (a: string | undefined) => (a ? s.accountNames[a] ?? "" : "");
  const gl: GlLine[] = [
    { key: "bank", account: s.accounts.bank ?? "", accountName: name(s.accounts.bank), description: `COD remittance ${d.batchId}`, amount: totals.net },
    { key: "fees", account: s.accounts.fees ?? "", accountName: name(s.accounts.fees), description: `${d.courier} COD fees ${d.batchId}`, amount: totals.fees },
    { key: "feeVat", account: s.accounts.feeVat ?? "", accountName: name(s.accounts.feeVat), description: `VAT on ${d.courier} COD fees ${d.batchId}`, amount: totals.vat },
    { key: "clearing", account: s.accounts.clearing ?? "", accountName: name(s.accounts.clearing), description: `COD collected ${d.batchId}`, amount: r2(-totals.collected) },
  ].filter((l) => cents(l.amount) !== 0) as GlLine[];
  const label: Record<GlLine["key"], string> = { bank: "the bank the courier pays into", fees: "COD fees", feeVat: "VAT on fees", clearing: "courier clearing" };
  for (const l of gl) if (!l.account) blockers.push(`Choose the account for ${label[l.key]}.`);
  if (!d.postingDate) blockers.push("Set the posting date.");
  return { payments, gl, totals, checks, blockers, warnings, flags };
}

/** Business Central's document number limit is 20 characters. */
export const documentNumber = (d: RemittanceDraft) => d.batchId.slice(0, 20);

export const CSV_HEADERS = ["Type", "Posting date", "Document no.", "External document no.", "Account type", "Account no.", "Applies-to invoice no.", "Order reference", "Description", "Amount", "Currency"];

export function remittanceCsv(items: { draft: RemittanceDraft; review: RemittanceReview }[]): string {
  const rows = items.flatMap(({ draft: d, review: r }) => [
    ...r.payments.map((p) => ["Customer payment", d.postingDate, documentNumber(d), p.awb, "Customer", p.customerNumber, p.invoiceNumber, p.orderRef, p.description, String(p.amount), d.currency]),
    ...r.gl.map((l) => ["G/L", d.postingDate, documentNumber(d), "", "G/L Account", l.account, "", "", l.description, String(l.amount), d.currency]),
  ]);
  return Papa.unparse({ fields: CSV_HEADERS, data: rows });
}

/** Only what the user may change: each parcel's action, and the posting date. */
export function applyEdits(d: RemittanceDraft, input: unknown): RemittanceDraft | undefined {
  if (!input || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  const actions = (o.actions ?? {}) as Record<string, unknown>;
  const valid = new Set(["apply", "on_account", "exclude"]);
  const date = typeof o.postingDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.postingDate) ? o.postingDate : d.postingDate;
  return {
    ...d,
    postingDate: date,
    parcels: d.parcels.map((p) => {
      const a = actions[keyOf(p)];
      return typeof a === "string" && valid.has(a) ? { ...p, action: a as ParcelAction } : a === null ? { ...p, action: null } : p;
    }),
  };
}

export { keyOf as parcelKey };
