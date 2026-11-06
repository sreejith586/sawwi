import { createHash } from "node:crypto";
import { invoiceChecks, invoiceFromText, invoiceMetaRows, invoiceRows, INVOICE_HEADERS, LINE_HEADERS, looksLikeInvoice, type InvoiceGrain } from "./invoice";
import { groupLines, normalizeAmountCell, readTable, toWords, type Line, type TableExtraction } from "./layout";
import { loadPdf, PdfInputError, SCANNED_MESSAGE } from "./read";
import { buildStatement, statementMetaRows } from "./statement";
import type { InvoiceDoc, LayoutMemory, LayoutRecipe, PdfFileInfo, PdfMethod } from "./types";
import { decodeZatcaQr, looksLikeUbl, parseUblInvoice } from "./zatca";

export { PdfInputError, SCANNED_MESSAGE } from "./read";
export type { LayoutMemory, LayoutRecipe, PdfFileInfo } from "./types";

// PDF → { headers, rows }, cheapest first and with no AI:
// 1. embedded ZATCA UBL XML; 2. the text layer (with the ZATCA QR as a fallback for
// invoice totals); 3. a per-workspace layout memory so a repeat statement reuses its recipe.

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

    const lines = groupLines(toWords(pdf.pages.flatMap((p) => p.items)));
    const chars = lines.reduce((s, l) => s + l.text.replace(/\s/g, "").length, 0);
    if (chars < 20 * Math.min(pdf.numPages, 3)) {
      // No text layer. A QR-only invoice can still give us totals; anything else needs OCR.
      const qr = await zatcaQr(pdf, [1, pdf.numPages]);
      if (qr) return invoiceTable(fileName, qr, "zatca_qr", pdf.numPages, opts);
      const images = await pdf.imageCount([1, 2, 3]);
      throw new PdfInputError(images > 0 ? SCANNED_MESSAGE : "This PDF has no readable text. Export it as CSV/Excel, or upload a text PDF.");
    }

    // 2. Text layer, using a saved layout for this issuer when there is one.
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
      const out = invoiceTable(fileName, doc, "text", pdf.numPages, opts);
      if (table) out.info.layout = remember(opts.layouts, issuer, table, "invoice");
      return out;
    }

    if (!table || table.rows.length === 0) {
      throw new PdfInputError("Sawwi couldn't find a table in this PDF. Export it as CSV/Excel, or upload the statement or invoice PDF from your bank or supplier portal.");
    }

    if (isStatement) {
      const s = buildStatement(table);
      return {
        headers: s.headers,
        rows: s.rows,
        info: {
          fileName,
          kind: "statement",
          method: "text",
          pages: pdf.numPages,
          layout: remember(opts.layouts, issuer, table, "statement"),
          meta: statementMetaRows(s.meta),
          checks: s.checks,
          skipped: s.skipped,
        },
      };
    }

    // Any other table: settlement statements, payout reports, remittances.
    return {
      headers: table.columns.map((c) => c.name),
      rows: table.rows.map((r) => r.cells.map((c, i) => normalizeAmountCell(c, table.columns[i].role))),
      info: {
        fileName,
        kind: "table",
        method: "text",
        pages: pdf.numPages,
        layout: remember(opts.layouts, issuer, table, "table"),
        meta: statementMetaRows(buildStatement(table).meta).filter((m) => m.label === "Issuer" || m.label === "Period" || m.label === "Currency"),
        checks: [],
        skipped: table.specials.length + table.repeatedHeaders,
      },
    };
  } finally {
    await pdf.close();
  }
}

function remember(layouts: LayoutMemory | undefined, issuer: string, t: TableExtraction & { recipe?: LayoutRecipe }, kind: LayoutRecipe["kind"]) {
  if (!layouts) return undefined;
  const recipe: LayoutRecipe = { version: 1, issuerKey: issuer, fingerprint: layoutFingerprint(issuer, t), kind, headerTokens: t.headerTokens, columns: t.columns };
  layouts.save(recipe);
  return t.recipe ? "remembered" : "learned";
}

async function zatcaQr(pdf: Awaited<ReturnType<typeof loadPdf>>, pages: number[]) {
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
