import { clusters, isMoney, joinWords, type Line, type TableExtraction } from "./layout";
import { cents, findCurrency, formatAmount, parseAmount } from "./text";
import type { InvoiceDoc, InvoiceLine, PdfCheck } from "./types";

// Invoices read from the text layer: labelled header fields, the line-item table, and
// the summary block (subtotal, VAT, total). Then lines → subtotal and VAT = rate × net.

const DATE = String.raw`(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[ -][A-Za-z]{3,9}[ -,]+\d{2,4})`;
// An invoice number has a digit: "Invoice No:  Bill To: …" with the number left blank isn't "Bill".
const NUMBER = [/(?:tax\s+)?invoice\s*(?:no\.?|number|#|num)\s*[:.\-]?\s*((?=[A-Z\-\/]*\d)[A-Z0-9][A-Z0-9\-\/]*)/i, /رقم\s+الفاتورة\s*[:\-]?\s*((?=[A-Z\-\/]*\d)[A-Z0-9][A-Z0-9\-\/]*)/i];
const CREDIT_NUMBER = /credit\s+note\s*(?:no\.?|number|#)\s*[:.\-]?\s*([A-Z0-9][A-Z0-9\-\/]*)/i;
const DATES = [
  new RegExp(String.raw`(?:invoice\s+date|date\s+of\s+(?:issue|supply)|issue\s+date|تاريخ\s+الفاتورة|تاريخ\s+الإصدار)\s*[:\-]?\s*${DATE}`, "i"),
  new RegExp(String.raw`\bdate\s*[:\-]\s*${DATE}`, "i"),
];
const DUE = new RegExp(String.raw`(?:due\s+date|payment\s+due(?:\s+date)?|due\s+on|تاريخ\s+الاستحقاق)\s*[:\-]?\s*${DATE}`, "i");
const TRN = /(?:TRN|VAT\s*(?:reg(?:istration)?\.?\s*)?(?:no\.?|number|#|id)|tax\s+registration\s+(?:no\.?|number)|الرقم\s+الضريبي|رقم\s+التسجيل\s+الضريبي)\s*[:\-]?\s*(\d{15})/gi;
const PO = /(?:\bP\.?\s?O\.?|purchase\s+order)(?!\s*box)\s*(?:no\.?|number|#|ref\.?)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i;
const SELLER = /^(?:seller|supplier|vendor|from|البائع|المورد)\s*[:\-]\s*(.+)$/i;
const BUYER = /^(?:buyer|customer|bill\s+to|sold\s+to|client|المشتري|العميل)\s*[:\-]\s*(.+)$/i;
const SUBTOTAL = /^(?:sub\s*-?\s*total|total\s+(?:excl(?:uding|\.)?|before|without)\s+(?:vat|tax)|taxable\s+amount|total\s+taxable(?:\s+amount)?|net\s+amount|amount\s+before\s+vat)|المجموع\s+الفرعي|الإجمالي\s+قبل\s+الضريبة|المبلغ\s+الخاضع\s+للضريبة/i;
const VAT = /^(?:total\s+)?(?:vat|tax)(?!\s*(?:no\b|number|reg|registration|#|id\b))|ضريبة\s+القيمة\s+المضافة|مجموع\s+الضريبة/i;
const TOTAL = /^(?:grand\s+total|total\s+(?:incl(?:uding|\.)?|with)\s+(?:vat|tax)|total\s+amount(?:\s+due)?|amount\s+due|invoice\s+total|total\s+due|total)\b|الإجمالي|المبلغ\s+المستحق/i;

const lastMoney = (text: string) => {
  const m = text.split(/\s+/).filter((t) => isMoney(t.replace(/^(AED|SAR)/i, "")));
  return m.length ? parseAmount(m[m.length - 1]) : undefined;
};
/** Label text without leading amounts (Arabic lines read right to left, so the amount may come first). */
const label = (text: string) => text.replace(/^([\d,.()\-]+\s*(AED|SAR)?\s*)+/i, "").trim();

export function looksLikeInvoice(lines: Line[]): boolean {
  const text = lines.map((l) => l.text).join("\n");
  return /\b(tax\s+)?invoice\b|فاتورة|\bcredit\s+note\b/i.test(text) && (NUMBER.some((r) => r.test(text)) || CREDIT_NUMBER.test(text));
}

export function invoiceFromText(lines: Line[], table: TableExtraction | undefined): InvoiceDoc {
  const doc: InvoiceDoc = { type: "Invoice", lines: [] };
  const all = lines.map((l) => l.text);
  const joined = all.join("\n");
  if (/\bcredit\s+note\b|إشعار\s+دائن/i.test(joined)) doc.type = "Credit note";
  else if (/\bdebit\s+note\b|إشعار\s+مدين/i.test(joined)) doc.type = "Debit note";

  for (const s of all) {
    doc.number ??= (doc.type === "Credit note" ? CREDIT_NUMBER.exec(s)?.[1] : undefined) ?? NUMBER.map((r) => r.exec(s)?.[1]).find(Boolean);
    const due = DUE.exec(s)?.[1];
    doc.dueDate ??= due;
    // A due date isn't the invoice date: the generic "Date:" pattern skips lines that only give one.
    doc.date ??= DATES.map((r, i) => (i > 0 && due ? undefined : r.exec(s)?.[1])).find(Boolean);
    doc.poNumber ??= PO.exec(s)?.[1];
  }
  // "Seller:" / "Bill To:" blocks often share a line with other labels: read them per cluster.
  for (const part of lines.flatMap((l) => clusters(l).map(joinWords))) {
    doc.seller ??= SELLER.exec(part)?.[1].trim();
    doc.buyer ??= BUYER.exec(part)?.[1].trim();
  }
  const trns = [...joined.matchAll(TRN)].map((m) => m[1]);
  [doc.sellerVat, doc.buyerVat] = [trns[0], trns.find((t) => t !== trns[0])];
  if (!doc.seller) {
    const firstPage = Math.min(...lines.map((l) => l.page));
    doc.seller = lines.filter((l) => l.page === firstPage && !/invoice|فاتورة|credit\s+note/i.test(l.text)).sort((a, b) => a.y - b.y)[0]?.text;
  }
  doc.currency = findCurrency(joined);

  // Summary block: each line is used for one figure only, checked most specific first.
  const summary = [...lines].sort((a, b) => a.page - b.page || a.y - b.y).map((l) => ({ text: label(l.text), raw: l.text }));
  for (const s of summary) {
    const value = lastMoney(s.raw);
    if (value === undefined) continue;
    if (SUBTOTAL.test(s.text)) doc.subtotal = value;
    else if (VAT.test(s.text)) {
      doc.vat = value;
      const rate = /(\d+(?:\.\d+)?)\s*%/.exec(s.raw);
      if (rate) doc.vatRate = Number(rate[1]);
    } else if (TOTAL.test(s.text)) doc.total = value;
  }

  if (table) doc.lines = linesFromTable(table);
  if (doc.subtotal === undefined && doc.total !== undefined && doc.vat !== undefined) doc.subtotal = round2(doc.total - doc.vat);
  return doc;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function linesFromTable(t: TableExtraction): InvoiceLine[] {
  const at = (role: string) => t.columns.findIndex((c) => c.role === role);
  const [desc, sku, qty, price, net, amount, rate, vat, total] = ["description", "sku", "qty", "unit_price", "net", "amount", "vat_rate", "vat", "total"].map(at);
  const n = (r: string[], i: number) => (i >= 0 ? parseAmount(r[i]) ?? (/^\d+(\.\d+)?$/.test(r[i]) ? Number(r[i]) : undefined) : undefined);
  return t.rows.map(({ cells }) => {
    const line: InvoiceLine = {
      description: desc >= 0 ? cells[desc] || undefined : undefined,
      sku: sku >= 0 ? cells[sku] || undefined : undefined,
      qty: n(cells, qty),
      unitPrice: n(cells, price),
      net: n(cells, net) ?? n(cells, amount),
      vatRate: rate >= 0 ? Number(/(\d+(\.\d+)?)/.exec(cells[rate])?.[1] ?? NaN) || undefined : undefined,
      vat: n(cells, vat),
      total: n(cells, total),
    };
    // "Amount" next to VAT and Total columns is the net; on its own it's the line total excl. VAT too.
    if (line.net === undefined && line.total !== undefined && line.vat !== undefined) line.net = round2(line.total - line.vat);
    if (line.net === undefined && line.total !== undefined && vat < 0) line.net = line.total;
    return line;
  });
}

/** Standard VAT rates by country, percent. */
export const VAT_RATES: Record<string, number> = { AE: 5, SA: 15, BH: 10, OM: 5, QA: 0, KW: 0 };
const COUNTRY_NAMES: Record<string, string> = { AE: "UAE", SA: "KSA", BH: "Bahrain", OM: "Oman", QA: "Qatar", KW: "Kuwait" };

export function invoiceChecks(doc: InvoiceDoc, countries: string[] = []): PdfCheck[] {
  const checks: PdfCheck[] = [];
  const ccy = doc.currency ? `${doc.currency} ` : "";
  const money = (n: number) => `${ccy}${formatAmount(n)}`;
  const nets = doc.lines.map((l) => l.net).filter((n): n is number => n !== undefined);

  if (doc.subtotal !== undefined && nets.length > 0 && nets.length === doc.lines.length) {
    const sum = nets.reduce((s, n) => s + cents(n), 0);
    const ok = Math.abs(sum - cents(doc.subtotal)) <= Math.max(1, Math.ceil(doc.lines.length / 2));
    checks.push({
      id: "lines_subtotal",
      label: "Lines add up to the subtotal",
      ok,
      detail: ok
        ? `${doc.lines.length} line${doc.lines.length === 1 ? "" : "s"} add up to ${money(sum / 100)}.`
        : `The ${doc.lines.length} lines add up to ${money(sum / 100)}, but the subtotal says ${money(doc.subtotal)}. A line may be missing or misread.`,
    });
  }

  const qtyMiss = doc.lines.filter((l) => l.qty !== undefined && l.unitPrice !== undefined && l.net !== undefined && Math.abs(cents(l.qty * l.unitPrice) - cents(l.net)) > 1);
  if (qtyMiss.length > 0) {
    checks.push({
      id: "qty_price",
      label: "Qty × unit price = line amount",
      ok: false,
      detail: `${qtyMiss.length} line${qtyMiss.length === 1 ? "" : "s"} where quantity × price differs from the line amount (e.g. "${qtyMiss[0].description ?? qtyMiss[0].sku ?? "line"}").`,
    });
  }

  if (doc.vat !== undefined && doc.subtotal !== undefined && doc.subtotal !== 0) {
    const expectedRates = [...new Set(countries.map((c) => VAT_RATES[c]).filter((r) => r !== undefined && r > 0))];
    const actual = (doc.vat / doc.subtotal) * 100;
    // The printed rate, else the standard GCC rate the VAT matches, else the workspace's own rate.
    const closest = (rates: number[]) => [...rates].sort((a, b) => Math.abs(a - actual) - Math.abs(b - actual))[0];
    const standard = closest([5, 10, 15]);
    const rate = doc.vatRate ?? (Math.abs(standard - actual) < 0.2 ? standard : closest(expectedRates.length ? expectedRates : [5, 10, 15]));
    const expectedVat = round2((doc.subtotal * rate) / 100);
    const vatOk = Math.abs(cents(expectedVat) - cents(doc.vat)) <= Math.max(1, doc.lines.length);
    const where = Object.entries(VAT_RATES)
      .filter(([c, r]) => r === rate && (countries.length === 0 || countries.includes(c)))
      .map(([c]) => COUNTRY_NAMES[c]);
    const rateOk = expectedRates.length === 0 || expectedRates.includes(rate);
    checks.push({
      id: "vat_rate",
      label: "VAT = rate × net",
      ok: vatOk && rateOk,
      detail: !vatOk
        ? `VAT is ${money(doc.vat)}, but ${rate}% of ${money(doc.subtotal)} is ${money(expectedVat)} (the VAT is ${actual.toFixed(2)}% of net).`
        : !rateOk
          ? `VAT is charged at ${rate}%, but your business is set up for ${expectedRates.map((r) => `${r}%`).join(" / ")}.`
          : `${money(doc.vat)} is ${rate}% of ${money(doc.subtotal)}${where.length ? ` (${where.join(" / ")} rate)` : ""}.`,
    });
  }

  if (doc.subtotal !== undefined && doc.vat !== undefined && doc.total !== undefined) {
    const ok = Math.abs(cents(doc.subtotal) + cents(doc.vat) - cents(doc.total)) <= 1;
    checks.push({
      id: "total",
      label: "Net + VAT = total",
      ok,
      detail: ok
        ? `${money(doc.subtotal)} + ${money(doc.vat)} = ${money(doc.total)}.`
        : `${money(doc.subtotal)} + ${money(doc.vat)} = ${money(round2(doc.subtotal + doc.vat))}, but the total says ${money(doc.total)}.`,
    });
  }
  return checks;
}

export function invoiceMetaRows(doc: InvoiceDoc): { label: string; value: string }[] {
  const ccy = doc.currency ? `${doc.currency} ` : "";
  const rows: [string, string | undefined][] = [
    ["Document", doc.type],
    ["Number", doc.number],
    ["Date", doc.date],
    ["Due date", doc.dueDate],
    ["Seller", doc.seller],
    ["Seller VAT no.", doc.sellerVat],
    ["Buyer", doc.buyer],
    ["PO number", doc.poNumber],
    ["Net", doc.subtotal !== undefined ? ccy + formatAmount(doc.subtotal) : undefined],
    ["VAT", doc.vat !== undefined ? `${ccy}${formatAmount(doc.vat)}${doc.vatRate !== undefined ? ` (${doc.vatRate}%)` : ""}` : undefined],
    ["Total", doc.total !== undefined ? ccy + formatAmount(doc.total) : undefined],
  ];
  return rows.filter((r): r is [string, string] => Boolean(r[1])).map(([label, value]) => ({ label, value }));
}

export type InvoiceGrain = "invoice" | "line";

export const INVOICE_HEADERS = [
  "Invoice number",
  "Invoice date",
  "Document type",
  "Supplier",
  "Supplier VAT number",
  "Buyer",
  "Buyer VAT number",
  "PO number",
  "Currency",
  "Amount excl. VAT",
  "VAT",
  "VAT rate %",
  "Total incl. VAT",
  "Lines",
];

export const LINE_HEADERS = [
  "Invoice number",
  "Invoice date",
  "Supplier",
  "PO number",
  "Line",
  "Description",
  "SKU",
  "Qty",
  "Unit price",
  "Line amount excl. VAT",
  "VAT rate %",
  "VAT",
  "Line total",
  "Currency",
];

const fmt = (n: number | undefined, sign = 1) => (n === undefined ? "" : formatAmount(n * sign));
const plain = (n: number | undefined) => (n === undefined ? "" : String(n));

/** One row per invoice, or one per line. Credit notes are negative so they net off. */
export function invoiceRows(doc: InvoiceDoc, grain: InvoiceGrain): string[][] {
  const sign = doc.type === "Credit note" ? -1 : 1;
  if (grain === "invoice") {
    return [
      [
        doc.number ?? "",
        doc.date ?? "",
        doc.type,
        doc.seller ?? "",
        doc.sellerVat ?? "",
        doc.buyer ?? "",
        doc.buyerVat ?? "",
        doc.poNumber ?? "",
        doc.currency ?? "",
        fmt(doc.subtotal, sign),
        fmt(doc.vat, sign),
        plain(doc.vatRate),
        fmt(doc.total, sign),
        String(doc.lines.length),
      ],
    ];
  }
  const lines: InvoiceLine[] = doc.lines.length ? doc.lines : [{ description: "(no line detail)", net: doc.subtotal, vat: doc.vat, total: doc.total, vatRate: doc.vatRate }];
  return lines.map((l, i) => [
    doc.number ?? "",
    doc.date ?? "",
    doc.seller ?? "",
    doc.poNumber ?? "",
    String(i + 1),
    l.description ?? "",
    l.sku ?? "",
    l.qty === undefined ? "" : String(l.qty * sign),
    fmt(l.unitPrice),
    fmt(l.net, sign),
    plain(l.vatRate ?? doc.vatRate),
    fmt(l.vat, sign),
    fmt(l.total, sign),
    doc.currency ?? "",
  ]);
}
