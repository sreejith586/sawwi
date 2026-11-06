import { createHash } from "node:crypto";
import { invoiceChecks, invoiceFromText, invoiceMetaRows, invoiceRows, INVOICE_HEADERS, LINE_HEADERS, looksLikeInvoice, type InvoiceGrain } from "./invoice";
import { groupLines, normalizeAmountCell, readTable, toWords, type Line, type TableExtraction } from "./layout";
import { MAX_OCR_PAGES, LOW_CONFIDENCE, ocrPages, type OcrItem } from "./ocr";
import { loadPdf, PdfInputError, type LoadedPdf } from "./read";
import { buildStatement, statementMetaRows } from "./statement";
import type { InvoiceDoc, LayoutMemory, LayoutRecipe, PdfFileInfo, PdfMethod } from "./types";
import { decodeZatcaQr, looksLikeUbl, parseUblInvoice } from "./zatca";

export { PdfInputError } from "./read";
export { MAX_OCR_PAGES } from "./ocr";

const SCANNED_UNREADABLE = "Sawwi couldn't read this scan. Upload a clearer scan (at least 200 dpi, straight and in focus), a text PDF, or a CSV/Excel export.";
export type { LayoutMemory, LayoutRecipe, PdfFileInfo } from "./types";

// PDF → { headers, rows }, cheapest first and with no AI:
// 1. embedded ZATCA UBL XML; 2. the text layer, or local OCR of scanned pages (D-24), with
// the ZATCA QR as a fallback for invoice totals; 3. a per-workspace layout memory so a repeat
// statement reuses its recipe.

export type PdfOptions = {
  /** "line" when the slot wants invoice lines (SKU, qty), else one row per invoice. */
  grain?: InvoiceGrain;
  layouts?: LayoutMemory;
  /** Workspace countries, for the expected VAT rate. */
  countries?: string[];
};

export type PdfTable = { headers: string[]; rows: string[][]; info: PdfFileInfo };

/** A stable key for "who issued this": the top line of page 1, without digits (dates, account numbers). */
export function issuerKey(lines: Line[]): string {
  const top = lines
    .filter((l) => l.page === 1)
    .sort((a, b) => a.y - b.y)
    .slice(0, 2)
    .map((l) => l.text.toLowerCase().replace(/[\d\W_]+/gu, " ").trim())
    .join("|");
  return createHash("sha256").update(top).digest("hex").slice(0, 16);
}

function layoutFingerprint(issuer: string, t: TableExtraction): string {
  const bands = t.columns.map((c) => `${c.name.toLowerCase()}@${Math.round(c.x0 / 5) * 5}`).join(",");
  return createHash("sha256").update(`${issuer}|${bands}`).digest("hex").slice(0, 16);
}

export async function extractPdf(fileName: string, bytes: Uint8Array, opts: PdfOptions = {}): Promise<PdfTable> {
  const pdf = await loadPdf(bytes);
  try {
    // 1. Embedded e-invoice XML: exact values, no layout guessing.
    for (const a of pdf.attachments) {
      const xml = new TextDecoder("utf-8").decode(a.bytes);
      if (!looksLikeUbl(xml)) continue;
      const doc = parseUblInvoice(xml);
      if (doc) return invoiceTable(fileName, doc, "zatca_xml", pdf.numPages, opts);
    }

    let lines = groupLines(toWords(pdf.pages.flatMap((p) => p.items)));
    const chars = (ls: Line[]) => ls.reduce((s, l) => s + l.text.replace(/\s/g, "").length, 0);
    let ocr: { items: OcrItem[]; confidence: number; pages: number } | undefined;
    let qrOnly: Awaited<ReturnType<typeof zatcaQr>>;
    if (chars(lines) < 20 * Math.min(pdf.numPages, 3)) {
      // 2. No text layer: a scan. OCR it locally (D-24); the ZATCA QR is kept as a fallback for invoices.
      qrOnly = await zatcaQr(pdf, [1, pdf.numPages]);
      if (pdf.numPages > MAX_OCR_PAGES) {
        if (qrOnly) return invoiceTable(fileName, qrOnly, "zatca_qr", pdf.numPages, opts);
        throw new PdfInputError(`This scanned PDF has ${pdf.numPages} pages. Sawwi reads up to ${MAX_OCR_PAGES} scanned pages at a time: split it, or export the data as CSV/Excel.`);
      }
      const images = await pdf.pageImages(Array.from({ length: pdf.numPages }, (_, i) => i + 1));
      if (images.length === 0) {
        if (qrOnly) return invoiceTable(fileName, qrOnly, "zatca_qr", pdf.numPages, opts);
        throw new PdfInputError("This PDF has no readable text or scanned pages. Export it as CSV/Excel, or upload a text PDF.");
      }
      const result = await ocrPages(images);
      lines = groupLines(toWords(result.items));
      if (chars(lines) < 20 * Math.min(images.length, 3)) {
        if (qrOnly) return invoiceTable(fileName, qrOnly, "zatca_qr", pdf.numPages, opts);
        throw new PdfInputError(SCANNED_UNREADABLE);
      }
      ocr = { ...result, pages: images.length };
    }

    const out = await fromLines(fileName, lines, pdf, opts, ocr ? "ocr" : "text");
    if (!out) {
      if (qrOnly) return invoiceTable(fileName, qrOnly, "zatca_qr", pdf.numPages, opts);
      throw new PdfInputError(
        ocr
          ? SCANNED_UNREADABLE
          : "Sawwi couldn't find a table in this PDF. Export it as CSV/Excel, or upload the statement or invoice PDF from your bank or supplier portal.",
      );
    }
    if (ocr) {
      out.result.info.ocr = {
        pages: ocr.pages,
        confidence: Math.round(ocr.confidence),
        lowConfidenceRows: lowConfidenceRows(out.rowsAt, out.result.rows.length, ocr.items),
      };
    }
    return out.result;
  } finally {
    await pdf.close();
  }
}

/** Rows that came from a line holding an OCR word below the confidence floor (1-based). */
function lowConfidenceRows(rowsAt: { page: number; y: number }[] | undefined, rowCount: number, items: OcrItem[]): number[] {
  const low = items.filter((i) => i.confidence < LOW_CONFIDENCE);
  if (!rowsAt) return low.length && rowCount ? [1] : [];
  return rowsAt.flatMap((r, i) => (low.some((w) => w.page === r.page && Math.abs(w.y - r.y) <= 0.6 * w.h) ? [i + 1] : []));
}

/** The text-layer (or OCR) path: statement, invoice or any other table. Undefined when there's no table. */
async function fromLines(
  fileName: string,
  lines: Line[],
  pdf: LoadedPdf,
  opts: PdfOptions,
  method: "text" | "ocr",
): Promise<{ result: PdfTable; rowsAt?: { page: number; y: number }[] } | undefined> {
  // A saved layout for this issuer is used first.
  const issuer = issuerKey(lines);
  const recipes = opts.layouts?.find(issuer) ?? [];
  const table = readTable(lines, { recipes });
  const isStatement = table?.columns.some((c) => c.role === "balance") && table.columns.some((c) => ["debit", "credit", "amount"].includes(c.role));

  if (!isStatement && looksLikeInvoice(lines)) {
    const doc = invoiceFromText(lines, table);
    // The ZATCA QR fills totals and seller details the text didn't give us.
    if (doc.total === undefined || doc.vat === undefined || !doc.sellerVat) {
      const qr = await zatcaQr(pdf, [1, pdf.numPages]);
      if (qr) {
        doc.total ??= qr.total;
        doc.vat ??= qr.vat;
        doc.sellerVat ??= qr.sellerVat;
        doc.seller ??= qr.seller;
        doc.date ??= qr.date;
        if (doc.subtotal === undefined && doc.total !== undefined && doc.vat !== undefined) doc.subtotal = Math.round((doc.total - doc.vat) * 100) / 100;
      }
    }
    const result = invoiceTable(fileName, doc, method, pdf.numPages, opts);
    if (table) result.info.layout = remember(opts.layouts, issuer, table, "invoice");
    const perLine = (opts.grain ?? "invoice") === "line" && table && doc.lines.length === table.rows.length;
    return { result, rowsAt: perLine ? table.rows : undefined };
  }

  if (!table || table.rows.length === 0) return undefined;

  if (isStatement) {
    const s = buildStatement(table);
    return {
      rowsAt: table.rows,
      result: {
        headers: s.headers,
        rows: s.rows,
        info: {
          fileName,
          kind: "statement",
          method,
          pages: pdf.numPages,
          layout: remember(opts.layouts, issuer, table, "statement"),
          meta: statementMetaRows(s.meta),
          checks: s.checks,
          skipped: s.skipped,
        },
      },
    };
  }

  // Any other table: settlement statements, payout reports, remittances.
  return {
    rowsAt: table.rows,
    result: {
      headers: table.columns.map((c) => c.name),
      rows: table.rows.map((r) => r.cells.map((c, i) => normalizeAmountCell(c, table.columns[i].role))),
      info: {
        fileName,
        kind: "table",
        method,
        pages: pdf.numPages,
        layout: remember(opts.layouts, issuer, table, "table"),
        meta: statementMetaRows(buildStatement(table).meta).filter((m) => m.label === "Issuer" || m.label === "Period" || m.label === "Currency"),
        checks: [],
        skipped: table.specials.length + table.repeatedHeaders,
      },
    },
  };
}

function remember(layouts: LayoutMemory | undefined, issuer: string, t: TableExtraction & { recipe?: LayoutRecipe }, kind: LayoutRecipe["kind"]) {
  if (!layouts) return undefined;
  const recipe: LayoutRecipe = { version: 1, issuerKey: issuer, fingerprint: layoutFingerprint(issuer, t), kind, headerTokens: t.headerTokens, columns: t.columns };
  layouts.save(recipe);
  return t.recipe ? "remembered" : "learned";
}

async function zatcaQr(pdf: LoadedPdf, pages: number[]) {
  for (const code of await pdf.qrCodes([...new Set(pages)])) {
    const q = decodeZatcaQr(code);
    if (q) return { seller: q.seller, sellerVat: q.vatNumber, date: q.timestamp.slice(0, 10), total: q.total, vat: q.vat };
  }
  return undefined;
}

function invoiceTable(
  fileName: string,
  source: InvoiceDoc | { seller: string; sellerVat: string; date: string; total: number; vat: number },
  method: PdfMethod,
  pages: number,
  opts: PdfOptions,
): PdfTable {
  const doc: InvoiceDoc =
    "lines" in source
      ? source
      : { type: "Invoice", ...source, subtotal: Math.round((source.total - source.vat) * 100) / 100, lines: [], currency: "SAR" };
  const grain = opts.grain ?? "invoice";
  return {
    headers: grain === "line" ? LINE_HEADERS : INVOICE_HEADERS,
    rows: invoiceRows(doc, grain),
    info: {
      fileName,
      kind: "invoice",
      method,
      pages,
      meta: invoiceMetaRows(doc),
      checks: invoiceChecks(doc, opts.countries),
      skipped: 0,
    },
  };
}
