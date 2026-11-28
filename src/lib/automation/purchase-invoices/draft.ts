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
  /** The open purchase order line, with goods received and not yet invoiced, this line invoices (D-88). */
  po?: PoLink | null;
  /** The goods receipt (GRN) line this invoice line is for (D-92): suggested from the vendor's receipts, or linked. */
  grn?: GrnLink | null;
};

/** A posted purchase receipt (GRN) line in the ERP: which receipt, its order, and how much it received of the item. */
export type GrnLink = { number: string; orderNumber: string; postingDate: string; quantity: number };

/** A purchase order line in the ERP and the receipts (GRNs) that brought its goods in (D-88). */
export type PoLink = {
  orderNumber: string;
  orderId: string;
  lineId: string;
  /** Posted receipt (GRN) numbers for this order and item. */
  receipts: string[];
  /** Received and not yet invoiced, when it was matched. */
  open: number;
  /** The order line's direct unit cost. */
  poPrice: number;
};

/** "invoice": a standalone unposted purchase invoice (D-64). "order": against the purchase order and its receipts (D-88). */
export type PostTo = "invoice" | "order";

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
  /** Unset: a standalone invoice, Sawwi's default. "order" is set by PO matching or the user; "invoice" only by the user (D-88). */
  postTo?: PostTo;
  /**
   * The user confirmed the PO lines Sawwi suggested or they picked (D-88). Set by Sawwi only when
   * the invoice prints the PO number and every line agrees with it; any change to a link clears it.
   */
  poConfirmed?: boolean;
  /** A GRN number the user linked (or the invoice printed) to match against (D-92). */
  grnNumber?: string;
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

// ─── Item codes (D-89) ─────────────────────────────────────────────────────
// The supplier's item code, usually the barcode, is often the only link to the ERP item (GTIN, D-62),
// so the field holds the code alone, exactly as printed: letters and digits (codes can be
// alphanumeric), Western digits, never mixed with description text or Arabic words.

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
const toAsciiDigits = (s: string) => s.replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) - (d >= "۰" ? 0x6f0 : 0x660)) % 10));

/** A GTIN (EAN-8, UPC-A, EAN-13, GTIN-14) whose check digit is right. */
export function isGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((a, d, i) => a + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Splits what was read as an item code into the code and any other text. Codes are whole tokens,
 * never cut out of a longer one. A numeric barcode (8 to 14 digits, which scans often print in
 * groups: "3614 2737 60652") wins; otherwise the first Latin letters-and-digits token.
 */
export function cleanSku(raw: string): { code: string; rest: string } {
  const s = toAsciiDigits(raw ?? "").trim();
  if (!s) return { code: "", rest: "" };
  const digitRun = s.match(/(?<![\p{L}\d\-_./])\d(?:[ -]?\d){7,13}(?![\p{L}\d\-_./])/u);
  if (digitRun) {
    const code = digitRun[0].replace(/[ -]/g, "");
    if (code.length >= 8 && code.length <= 14) return { code, rest: (s.slice(0, digitRun.index) + " " + s.slice(digitRun.index! + digitRun[0].length)).replace(/\s+/g, " ").trim() };
  }
  const tokens = s.split(/\s+/);
  const i = tokens.findIndex((t) => /^[A-Za-z0-9][A-Za-z0-9\-_./]*$/.test(t) && /\d/.test(t));
  const j = i >= 0 ? i : tokens.findIndex((t) => /^[A-Za-z0-9][A-Za-z0-9\-_./]*$/.test(t));
  if (j < 0) return { code: "", rest: s };
  return { code: tokens[j].slice(0, 50), rest: tokens.filter((_, k) => k !== j).join(" ") };
}

/** The reader's invoice → a draft. Credit notes keep positive amounts; they aren't purchase invoices (D-60 backlog). */
export function draftFromInvoice(doc: InvoiceDoc): Draft {
  const lines: DraftLine[] = doc.lines.map((l) => {
    const net = l.net ?? (l.qty !== undefined && l.unitPrice !== undefined ? r2(l.qty * l.unitPrice) : undefined);
    const vatRate = l.vatRate ?? doc.vatRate;
    // Text read into the code column moves to the description, so the code stays clean (D-89).
    const sku = cleanSku(l.sku ?? "");
    return {
      description: [sku.rest, l.description ?? ""].filter(Boolean).join(" ").trim(),
      sku: sku.code,
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
  // Where the supplier uses barcodes, a line whose code isn't a valid barcode was likely misread (D-89).
  const barcodes = d.lines.filter((l) => isGtin(l.sku)).length;
  if (barcodes > 0 && barcodes * 2 >= d.lines.length) {
    d.lines.forEach((l, i) => {
      if (!isGtin(l.sku)) warnings.push(`Line ${i + 1}: ${l.sku ? `item code ${l.sku} isn't a valid barcode` : "no barcode"}. Check it against the PDF; it's what finds the ERP item.`);
    });
  }

  if (opts.erp) {
    if (!d.vendorNo) blockers.push("Pick the Business Central vendor for this supplier.");
    const uncoded = d.lines.findIndex((l) => !l.erpType || !l.erpNo);
    if (uncoded >= 0) blockers.push(`Line ${uncoded + 1} ("${d.lines[uncoded].description || d.lines[uncoded].sku || "line"}") needs an item or G/L account.`);
    orderChecks(d, blockers, warnings);
  }
  return { checks, blockers, warnings };
}

/** Price differences up to this share of the PO price are rounding, not a variance. */
export const PRICE_TOLERANCE = 0.005;

/** Three-way match (D-88): each line against its PO line and the goods received on it. */
function orderChecks(d: Draft, blockers: string[], warnings: string[]) {
  const name = (i: number) => `Line ${i + 1} ("${d.lines[i].description || d.lines[i].sku || "line"}")`;
  if (d.postTo === "order") {
    if (!d.poConfirmed && d.lines.some((l) => l.po)) {
      blockers.push(
        d.poNumber
          ? "Confirm the purchase order match against the order lines shown."
          : "The invoice prints no PO number: Sawwi suggested the open purchase order lines shown. Check them and confirm the match.",
      );
    }
    d.lines.forEach((l, i) => {
      if (!l.po) return blockers.push(`${name(i)} isn't on an open purchase order of this vendor with goods received and not invoiced. Post it as a standalone invoice, or receive it in Business Central first.`);
      const grns = l.grn ? [l.grn.number] : l.po.receipts;
      const grn = grns.length ? ` (GRN ${grns.join(", ")})` : "";
      if (l.qty !== null && l.qty > l.po.open + 1e-9) blockers.push(`${name(i)}: ${l.qty} invoiced, but only ${l.po.open} received and not yet invoiced on ${l.po.orderNumber}${grn}.`);
      if (l.unitPrice !== null && l.po.poPrice > 0 && Math.abs(l.unitPrice - l.po.poPrice) > l.po.poPrice * PRICE_TOLERANCE) {
        const pct = ((l.unitPrice - l.po.poPrice) / l.po.poPrice) * 100;
        warnings.push(`${name(i)}: price ${l.unitPrice} against ${l.po.poPrice} on ${l.po.orderNumber} (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%). The invoice price goes on the order line.`);
      }
    });
    // GRN against invoice and PO (D-92): the receipt must be for the line's order; a different quantity is worth a look.
    d.lines.forEach((l, i) => {
      if (!l.grn) return;
      if (l.po && l.grn.orderNumber && l.grn.orderNumber !== l.po.orderNumber) {
        blockers.push(`${name(i)}: GRN ${l.grn.number} is for ${l.grn.orderNumber}, but the line is matched to ${l.po.orderNumber}. Pick the order line or GRN that belong together.`);
      } else if (l.qty !== null && Math.abs(l.qty - l.grn.quantity) > 1e-9) {
        warnings.push(`${name(i)}: ${l.qty} on the invoice, ${l.grn.quantity} received on GRN ${l.grn.number}.`);
      }
    });
    const seen = new Map<string, number>();
    d.lines.forEach((l, i) => {
      if (!l.po) return;
      if (seen.has(l.po.lineId)) blockers.push(`${name(i)} and line ${seen.get(l.po.lineId)! + 1} invoice the same order line on ${l.po.orderNumber}. Combine them into one line.`);
      else seen.set(l.po.lineId, i);
    });
  } else {
    // A standalone invoice for goods already received on a PO would receive them a second time.
    const onPo = d.lines.flatMap((l, i) => (l.po ? [i] : []));
    if (onPo.length) {
      const l = d.lines[onPo[0]];
      // Only Sawwi's own guess blocks; a user who chose "standalone invoice" is warned instead.
      (d.postTo === "invoice" ? warnings : blockers).push(
        `${onPo.length === 1 ? name(onPo[0]) : `${onPo.length} lines, starting with ${name(onPo[0]).toLowerCase()},`} ${onPo.length === 1 ? "was" : "were"} received on ${l.po!.orderNumber}${l.po!.receipts.length ? ` (GRN ${l.po!.receipts.join(", ")})` : ""}. Post against the purchase order, or a standalone invoice would receive the goods again.`,
      );
    }
  }
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
    postTo: o.postTo === "order" ? "order" : o.postTo === "invoice" ? "invoice" : undefined,
    poConfirmed: o.poConfirmed === true ? true : undefined,
    grnNumber: str(o.grnNumber, 20) || undefined,
    lines: o.lines.map((raw) => {
      const l = (raw ?? {}) as Record<string, unknown>;
      const erpType = l.erpType === "item" || l.erpType === "account" ? l.erpType : null;
      return {
        description: str(l.description, 100),
        sku: cleanSku(str(l.sku, 50)).code,
        qty: num(l.qty),
        unitPrice: num(l.unitPrice),
        net: num(l.net),
        vatRate: num(l.vatRate),
        vat: num(l.vat),
        erpType,
        erpNo: erpType ? str(l.erpNo, 20) : "",
        matchedBy: by(l.matchedBy),
        po: sanitizePo(l.po),
        grn: sanitizeGrn(l.grn),
      };
    }),
  };
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizePo(v: unknown): PoLink | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : NaN);
  if (typeof p.orderNumber !== "string" || !GUID.test(String(p.orderId)) || !GUID.test(String(p.lineId)) || Number.isNaN(n(p.open)) || Number.isNaN(n(p.poPrice))) return null;
  const receipts = Array.isArray(p.receipts) ? p.receipts.filter((r): r is string => typeof r === "string").map((r) => r.slice(0, 20)).slice(0, 20) : [];
  return { orderNumber: p.orderNumber.slice(0, 20), orderId: String(p.orderId), lineId: String(p.lineId), receipts, open: n(p.open), poPrice: n(p.poPrice) };
}

function sanitizeGrn(v: unknown): GrnLink | null {
  if (!v || typeof v !== "object") return null;
  const g = v as Record<string, unknown>;
  if (typeof g.number !== "string" || !g.number.trim() || typeof g.quantity !== "number" || !Number.isFinite(g.quantity)) return null;
  const s = (x: unknown) => (typeof x === "string" ? x.slice(0, 20) : "");
  return { number: g.number.trim().slice(0, 20), orderNumber: s(g.orderNumber), postingDate: /^\d{4}-\d{2}-\d{2}$/.test(String(g.postingDate)) ? String(g.postingDate) : "", quantity: g.quantity };
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
  "Post to",
  "PO no. (matched)",
  "GRN no.",
  "PO unit cost",
  "Received not invoiced",
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
    d.postTo === "order" ? "Purchase order" : "Purchase invoice",
    l.po?.orderNumber ?? "",
    l.grn?.number ?? l.po?.receipts.join(" ") ?? "",
    plain(l.po?.poPrice ?? null),
    plain(l.po?.open ?? null),
  ]);
}

export function draftsCsv(drafts: Draft[]): string {
  return Papa.unparse({ fields: CSV_HEADERS, data: drafts.flatMap(csvRows) });
}
