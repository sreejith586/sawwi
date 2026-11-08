import Papa from "papaparse";
import type { InvoiceDoc } from "@/lib/pdf/types";

// A captured supplier invoice as the user reviews it (D-61): header, lines and totals, plus the
// ERP vendor, item and account numbers matched or picked for it (D-62). Pure functions, safe in the browser.

export type LineType = "item" | "account";
export type MatchedBy = "memory" | "trn" | "name" | "sku" | "gtin" | "user";

export type DraftLine = {
  description: string;
  /** The supplier's own code for the line, as printed. */
  sku: string;
  qty: number | null;
  unitPrice: number | null;
  /** Amount excluding VAT. */
  net: number | null;
  vatRate: number | null;
  vat: number | null;
  erpType: LineType | null;
  erpNo: string;
  matchedBy?: MatchedBy;
};

export type Draft = {
  supplierName: string;
  supplierTrn: string;
  invoiceNumber: string;
  /** ISO dates, or "" when unknown. */
  invoiceDate: string;
  dueDate: string;
  currency: string;
  poNumber: string;
  subtotal: number | null;
  vat: number | null;
  total: number | null;
  vendorNo: string;
  vendorName: string;
  vendorMatchedBy?: MatchedBy;
  lines: DraftLine[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const cents = (n: number) => Math.round(n * 100);

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A printed date as ISO. Numeric dates are read day first, as in the GCC; "" when it isn't a date. */
export function isoDate(raw: string | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = (y: number) => (y < 100 ? 2000 + y : y);
  const valid = (y: number, m: number, d: number) => {
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : "";
  };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) return valid(year(+m[3]), +m[2], +m[1]);
  m = /^(\d{1,2})[ -]([A-Za-z]{3,9})[ -,]+(\d{2,4})$/.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    return month ? valid(year(+m[3]), month, +m[1]) : "";
  }
  return "";
}

export const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The reader's invoice → a draft. Credit notes keep positive amounts; they aren't purchase invoices (D-60 backlog). */
export function draftFromInvoice(doc: InvoiceDoc): Draft {
  const lines: DraftLine[] = doc.lines.map((l) => {
    const net = l.net ?? (l.qty !== undefined && l.unitPrice !== undefined ? r2(l.qty * l.unitPrice) : undefined);
    const vatRate = l.vatRate ?? doc.vatRate;
    return {
      description: l.description ?? "",
      sku: l.sku ?? "",
      qty: l.qty ?? (net !== undefined ? 1 : null),
      unitPrice: l.unitPrice ?? (l.qty === undefined && net !== undefined ? net : null),
      net: net ?? null,
      vatRate: vatRate ?? null,
      vat: l.vat ?? (net !== undefined && vatRate !== undefined ? r2((net * vatRate) / 100) : null),
      erpType: null,
      erpNo: "",
    };
  });
  // No line table: one line for the whole invoice, for the user to split or code.
  if (lines.length === 0 && (doc.subtotal !== undefined || doc.total !== undefined)) {
    const net = doc.subtotal ?? (doc.total !== undefined && doc.vat !== undefined ? r2(doc.total - doc.vat) : doc.total!);
    lines.push({ description: "Invoice total", sku: "", qty: 1, unitPrice: net, net, vatRate: doc.vatRate ?? null, vat: doc.vat ?? null, erpType: null, erpNo: "" });
  }
  // VAT rate printed only on the summary: spread it over lines that have none.
  const rate = doc.vatRate ?? (doc.vat !== undefined && doc.subtotal ? Math.round((doc.vat / doc.subtotal) * 1000) / 10 : undefined);
  for (const l of lines) {
    if (l.vatRate === null && rate !== undefined && [0, 5, 10, 15].includes(rate)) l.vatRate = rate;
    if (l.vat === null && l.vatRate !== null && l.net !== null) l.vat = r2((l.net * l.vatRate) / 100);
  }
  return {
    supplierName: doc.seller ?? "",
    supplierTrn: doc.sellerVat ?? "",
    invoiceNumber: doc.number ?? "",
    invoiceDate: isoDate(doc.date),
    dueDate: isoDate(doc.dueDate),
    currency: doc.currency ?? "",
    poNumber: doc.poNumber ?? "",
    subtotal: doc.subtotal ?? null,
    vat: doc.vat ?? null,
    total: doc.total ?? null,
    vendorNo: "",
    vendorName: "",
    lines,
  };
}

/** Case, spaces, dashes and leading zeros don't make a different invoice number (D-63). */
export const normInvoiceNo = (s: string) => s.toUpperCase().replace(/[\s\-_/.#]/g, "").replace(/^0+(?=.)/, "");

// ─── Review ────────────────────────────────────────────────────────────────

export type DraftCheck = { id: string; label: string; ok: boolean; detail: string };
export type Review = {
  checks: DraftCheck[];
  /** Must be fixed before a push (and before "Ready"). */
  blockers: string[];
  warnings: string[];
};

const money = (n: number, ccy: string) => `${ccy ? `${ccy} ` : ""}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Totals checks and what's missing. `erp` adds what a push needs: vendor, and an item or account per line. */
export function reviewDraft(d: Draft, opts: { erp: boolean }): Review {
  const checks: DraftCheck[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];
  const ccy = d.currency;

  const nets = d.lines.map((l) => l.net);
  if (d.subtotal !== null && d.lines.length && nets.every((n) => n !== null)) {
    const sum = nets.reduce((s, n) => s + cents(n!), 0);
    const ok = Math.abs(sum - cents(d.subtotal)) <= Math.max(1, Math.ceil(d.lines.length / 2));
    checks.push({ id: "lines_subtotal", label: "Lines add up to the subtotal", ok, detail: ok ? `${d.lines.length} lines add up to ${money(sum / 100, ccy)}.` : `The lines add up to ${money(sum / 100, ccy)}, but the subtotal is ${money(d.subtotal, ccy)}.` });
  }
  const lineVat = d.lines.map((l) => l.vat);
  if (d.vat !== null && d.lines.length && lineVat.every((v) => v !== null)) {
    const sum = lineVat.reduce((s, v) => s + cents(v!), 0);
    const ok = Math.abs(sum - cents(d.vat)) <= Math.max(1, d.lines.length);
    checks.push({ id: "lines_vat", label: "Line VAT adds up to the VAT", ok, detail: ok ? `Line VAT adds up to ${money(sum / 100, ccy)}.` : `Line VAT adds up to ${money(sum / 100, ccy)}, but the invoice's VAT is ${money(d.vat, ccy)}.` });
  }
  if (d.subtotal !== null && d.vat !== null && d.total !== null) {
    const ok = Math.abs(cents(d.subtotal) + cents(d.vat) - cents(d.total)) <= 1;
    checks.push({ id: "total", label: "Net + VAT = total", ok, detail: ok ? `${money(d.subtotal, ccy)} + ${money(d.vat, ccy)} = ${money(d.total, ccy)}.` : `${money(d.subtotal, ccy)} + ${money(d.vat, ccy)} = ${money(r2(d.subtotal + d.vat), ccy)}, but the total is ${money(d.total, ccy)}.` });
  }
  const priceOff = d.lines.findIndex((l) => l.qty !== null && l.unitPrice !== null && l.net !== null && Math.abs(cents(l.qty * l.unitPrice) - cents(l.net)) > 1);
  if (priceOff >= 0) checks.push({ id: "qty_price", label: "Qty × unit price = line amount", ok: false, detail: `Line ${priceOff + 1}: ${d.lines[priceOff].qty} × ${d.lines[priceOff].unitPrice} isn't ${d.lines[priceOff].net}.` });
  for (const c of checks) if (!c.ok) blockers.push(c.detail);

  if (!d.invoiceNumber.trim()) blockers.push("The supplier's invoice number is missing.");
  if (!d.invoiceDate) blockers.push("The invoice date is missing.");
  if (d.total === null) blockers.push("The invoice total is missing.");
  if (d.lines.length === 0) blockers.push("The invoice has no lines.");
  const incomplete = d.lines.findIndex((l) => l.qty === null || l.unitPrice === null);
  if (incomplete >= 0) blockers.push(`Line ${incomplete + 1} needs a quantity and a unit price.`);
  if (d.dueDate && d.invoiceDate && d.dueDate < d.invoiceDate) warnings.push("The due date is before the invoice date.");
  if (!d.dueDate) warnings.push("No due date: Business Central will use the vendor's payment terms.");
  if (!d.supplierTrn) warnings.push("No supplier TRN on the invoice. A tax invoice from a VAT-registered supplier should show one.");

  if (opts.erp) {
    if (!d.vendorNo) blockers.push("Pick the Business Central vendor for this supplier.");
    const uncoded = d.lines.findIndex((l) => !l.erpType || !l.erpNo);
    if (uncoded >= 0) blockers.push(`Line ${uncoded + 1} ("${d.lines[uncoded].description || d.lines[uncoded].sku || "line"}") needs an item or G/L account.`);
  }
  return { checks, blockers, warnings };
}

/** Cleans what came from the browser: known keys only, numbers as numbers, ISO dates. */
export function sanitizeDraft(input: unknown): Draft | undefined {
  if (!input || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? r2(v) : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(/,/g, ""))) ? r2(Number(v.replace(/,/g, ""))) : null);
  const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? isoDate(v) : "");
  const by = (v: unknown): MatchedBy | undefined => (["memory", "trn", "name", "sku", "gtin", "user"].includes(v as string) ? (v as MatchedBy) : undefined);
  if (!Array.isArray(o.lines) || o.lines.length > 500) return undefined;
  return {
    supplierName: str(o.supplierName),
    supplierTrn: str(o.supplierTrn, 20).replace(/\s/g, ""),
    invoiceNumber: str(o.invoiceNumber, 35),
    invoiceDate: date(o.invoiceDate),
    dueDate: date(o.dueDate),
    currency: str(o.currency, 3).toUpperCase(),
    poNumber: str(o.poNumber, 35),
    subtotal: num(o.subtotal),
    vat: num(o.vat),
    total: num(o.total),
    vendorNo: str(o.vendorNo, 20),
    vendorName: str(o.vendorName),
    vendorMatchedBy: by(o.vendorMatchedBy),
    lines: o.lines.map((raw) => {
      const l = (raw ?? {}) as Record<string, unknown>;
      const erpType = l.erpType === "item" || l.erpType === "account" ? l.erpType : null;
      return {
        description: str(l.description, 100),
        sku: str(l.sku, 50),
        qty: num(l.qty),
        unitPrice: num(l.unitPrice),
        net: num(l.net),
        vatRate: num(l.vatRate),
        vat: num(l.vat),
        erpType,
        erpNo: erpType ? str(l.erpNo, 20) : "",
        matchedBy: by(l.matchedBy),
      };
    }),
  };
}

// ─── CSV (D-65) ────────────────────────────────────────────────────────────

export const CSV_HEADERS = [
  "Vendor No.",
  "Vendor name",
  "Vendor TRN",
  "Vendor invoice no.",
  "Invoice date",
  "Due date",
  "Currency",
  "Purchase order no.",
  "Line no.",
  "Type",
  "No.",
  "Description",
  "Supplier SKU",
  "Quantity",
  "Direct unit cost",
  "VAT %",
  "Line amount excl. VAT",
  "Line VAT",
  "Invoice amount excl. VAT",
  "Invoice VAT",
  "Invoice amount incl. VAT",
];

const plain = (n: number | null) => (n === null ? "" : String(n));

export function csvRows(d: Draft): string[][] {
  return d.lines.map((l, i) => [
    d.vendorNo,
    d.vendorName || d.supplierName,
    d.supplierTrn,
    d.invoiceNumber,
    d.invoiceDate,
    d.dueDate,
    d.currency,
    d.poNumber,
    String((i + 1) * 10000),
    l.erpType === "item" ? "Item" : l.erpType === "account" ? "G/L Account" : "",
    l.erpNo,
    l.description,
    l.sku,
    plain(l.qty),
    plain(l.unitPrice),
    plain(l.vatRate),
    plain(l.net),
    plain(l.vat),
    plain(d.subtotal),
    plain(d.vat),
    plain(d.total),
  ]);
}

export function draftsCsv(drafts: Draft[]): string {
  return Papa.unparse({ fields: CSV_HEADERS, data: drafts.flatMap(csvRows) });
}
