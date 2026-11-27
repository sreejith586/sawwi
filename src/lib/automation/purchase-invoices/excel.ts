import { workbook, type SheetColumn } from "@/lib/excel/sheet";
import { reviewDraft } from "./draft";
import type { Capture } from "./store";

// The Excel download (D-87, D-91): an "Invoices" sheet, one row per invoice with its status and
// what's still open, and a "Lines" sheet, one row per line with the invoice repeated: standard
// invoice columns first (item code, quantity, price, net, VAT, gross), then the ERP coding and the
// PO and GRN each line was matched to (D-88). Amounts are numbers, dates
// are dates, so it filters, sums and imports as it is.

const STATUS: Record<Capture["status"], string> = {
  failed: "Couldn't read",
  needs_review: "Needs review",
  ready: "Ready to approve",
  approved: "Approved",
  pushing: "Sending",
  pushed: "In ERP",
};

const METHOD: Record<string, string> = { text: "Text PDF", ocr: "Scan (OCR)", zatca_xml: "ZATCA e-invoice", zatca_qr: "ZATCA QR only" };

const INVOICE_COLUMNS: SheetColumn[] = [
  { header: "File", key: "file", width: 24 },
  { header: "Status", key: "status", width: 16 },
  { header: "Supplier", key: "supplier", width: 32 },
  { header: "Supplier TRN", key: "trn", width: 18 },
  { header: "Vendor No.", key: "vendorNo", width: 12 },
  { header: "Vendor invoice no.", key: "number", width: 18 },
  { header: "Invoice date", key: "date", type: "date", width: 13 },
  { header: "Due date", key: "due", type: "date", width: 13 },
  { header: "Currency", key: "currency", width: 9 },
  { header: "Purchase order no. (printed)", key: "po", width: 16 },
  { header: "Post to", key: "postTo", width: 16 },
  { header: "PO no. (matched)", key: "orders", width: 16 },
  { header: "GRN no.", key: "grns", width: 16 },
  { header: "Lines", key: "lines", type: "number", width: 7 },
  { header: "Quantity", key: "qty", type: "number", width: 9 },
  { header: "Amount excl. VAT", key: "subtotal", type: "money", width: 15 },
  { header: "VAT", key: "vat", type: "money", width: 12 },
  { header: "Amount incl. VAT", key: "total", type: "money", width: 15 },
  { header: "Totals check", key: "checks", width: 12 },
  { header: "Read by", key: "readBy", width: 14 },
  { header: "ERP document", key: "erp", width: 16 },
  { header: "To fix before posting", key: "issues", width: 60 },
];

// Standard invoice columns first, so the sheet reads and imports anywhere; the ERP columns follow (D-91).
const LINE_COLUMNS: SheetColumn[] = [
  { header: "Supplier", key: "supplier", width: 30 },
  { header: "Supplier VAT no.", key: "trn", width: 18, type: "text" },
  { header: "Invoice no.", key: "number", width: 16, type: "text" },
  { header: "Invoice date", key: "date", type: "date", width: 13 },
  { header: "Due date", key: "due", type: "date", width: 13 },
  { header: "Currency", key: "currency", width: 9 },
  { header: "PO no. (printed)", key: "po", width: 14, type: "text" },
  { header: "Line", key: "line", type: "number", width: 6 },
  { header: "Item code / barcode", key: "sku", width: 18, type: "text" },
  { header: "Description", key: "description", width: 40 },
  { header: "Quantity", key: "qty", type: "number", width: 9 },
  { header: "Unit price", key: "price", type: "money", width: 12 },
  { header: "Amount excl. VAT", key: "net", type: "money", width: 14 },
  { header: "VAT %", key: "vatRate", type: "number", width: 7 },
  { header: "VAT amount", key: "lineVat", type: "money", width: 12 },
  { header: "Amount incl. VAT", key: "gross", type: "money", width: 14 },
  { header: "Line VAT", key: "vatSource", width: 22 },
  { header: "Invoice amount excl. VAT", key: "subtotal", type: "money", width: 15 },
  { header: "Invoice VAT", key: "vat", type: "money", width: 12 },
  { header: "Invoice amount incl. VAT", key: "total", type: "money", width: 15 },
  { header: "Status", key: "status", width: 16 },
  { header: "ERP vendor no.", key: "vendorNo", width: 12 },
  { header: "ERP vendor name", key: "vendorName", width: 26 },
  { header: "ERP type", key: "type", width: 12 },
  { header: "ERP no.", key: "no", width: 14 },
  { header: "Post to", key: "postTo", width: 16 },
  { header: "PO no. (matched)", key: "order", width: 16 },
  { header: "GRN no.", key: "grn", width: 16 },
  { header: "PO unit cost", key: "poPrice", type: "money", width: 13 },
  { header: "Received not invoiced", key: "open", type: "number", width: 12 },
  { header: "File", key: "file", width: 22 },
];

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The invoice's own VAT rate (VAT ÷ net), when it's a standard GCC rate; for lines that print none. */
function invoiceRate(subtotal: number | null, vat: number | null): number | null {
  if (subtotal === null || vat === null || subtotal === 0) return null;
  const rate = Math.round((vat / subtotal) * 1000) / 10;
  return [0, 5, 10, 15].includes(rate) ? rate : null;
}

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

export async function capturesWorkbook(captures: Capture[], opts: { erp: boolean }): Promise<ArrayBuffer> {
  const invoices = captures.map((c) => {
    const d = c.draft;
    const review = reviewDraft(d, { erp: opts.erp });
    const issues = c.status === "failed" ? [c.failure?.message ?? "Couldn't read this PDF."] : c.status === "pushed" ? [] : [...review.blockers, ...(c.failure?.stage === "push" ? [`Last push failed: ${c.failure.message}`] : [])];
    return {
      file: c.fileName,
      status: STATUS[c.status],
      supplier: d.supplierName || d.vendorName,
      trn: d.supplierTrn,
      vendorNo: d.vendorNo,
      number: d.invoiceNumber,
      date: d.invoiceDate,
      due: d.dueDate,
      currency: d.currency,
      po: d.poNumber,
      postTo: c.status === "failed" ? "" : d.postTo === "order" ? "Purchase order" : "Purchase invoice",
      orders: uniq(d.lines.map((l) => l.po?.orderNumber ?? "")).join(", "),
      grns: uniq(d.lines.flatMap((l) => l.po?.receipts ?? [])).join(", "),
      lines: d.lines.length,
      qty: d.lines.reduce((s, l) => s + (l.qty ?? 0), 0),
      subtotal: d.subtotal,
      vat: d.vat,
      total: d.total,
      checks: c.status === "failed" ? "" : review.checks.every((x) => x.ok) ? "OK" : "Doesn't add up",
      readBy: c.source.ai?.used === "ai" ? "AI" : (METHOD[c.source.method] ?? c.source.method),
      erp: c.erp?.number ?? "",
      issues: issues.join(" · "),
    };
  });

  const lines = captures.flatMap((c) => {
    const d = c.draft;
    const rate = invoiceRate(d.subtotal, d.vat);
    return d.lines.map((l, i) => {
      // Many invoices print VAT only in the totals: the line's share is worked out from the invoice's rate, and labelled so.
      const vatRate = l.vatRate ?? rate;
      const lineVat = l.vat ?? (l.net !== null && vatRate !== null ? r2((l.net * vatRate) / 100) : null);
      return {
        supplier: d.supplierName || d.vendorName,
        vendorNo: d.vendorNo,
        vendorName: d.vendorName,
        trn: d.supplierTrn,
        number: d.invoiceNumber,
        date: d.invoiceDate,
        due: d.dueDate,
        currency: d.currency,
        po: d.poNumber,
        line: i + 1,
        type: l.erpType === "item" ? "Item" : l.erpType === "account" ? "G/L Account" : "",
        no: l.erpNo,
        description: l.description,
        sku: l.sku,
        qty: l.qty,
        price: l.unitPrice,
        vatRate,
        net: l.net,
        lineVat,
        gross: l.net !== null && lineVat !== null ? r2(l.net + lineVat) : null,
        vatSource: l.vat !== null ? "Printed" : lineVat !== null ? "Worked out from invoice rate" : "",
        status: STATUS[c.status],
        file: c.fileName,
        subtotal: d.subtotal,
        vat: d.vat,
        total: d.total,
        postTo: d.postTo === "order" ? "Purchase order" : "Purchase invoice",
        order: l.po?.orderNumber ?? "",
        grn: l.po?.receipts.join(", ") ?? "",
        poPrice: l.po?.poPrice ?? null,
        open: l.po?.open ?? null,
      };
    });
  });

  return workbook([
    { sheetName: "Invoices", columns: INVOICE_COLUMNS, rows: invoices },
    { sheetName: "Lines", columns: LINE_COLUMNS, rows: lines },
  ]);
}
