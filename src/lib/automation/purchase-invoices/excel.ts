import { workbook, type SheetColumn } from "@/lib/excel/sheet";
import { reviewDraft } from "./draft";
import type { Capture } from "./store";

// The Excel download (D-87): an "Invoices" sheet, one row per invoice with its status and what's
// still open, and a "Lines" sheet, one row per line with the header repeated, the same columns as
// the CSV (D-65) plus the PO and GRN each line was matched to (D-88). Amounts are numbers, dates
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

const LINE_COLUMNS: SheetColumn[] = [
  { header: "Vendor No.", key: "vendorNo", width: 11 },
  { header: "Vendor name", key: "vendorName", width: 30 },
  { header: "Vendor TRN", key: "trn", width: 18 },
  { header: "Vendor invoice no.", key: "number", width: 18 },
  { header: "Invoice date", key: "date", type: "date", width: 13 },
  { header: "Due date", key: "due", type: "date", width: 13 },
  { header: "Currency", key: "currency", width: 9 },
  { header: "Purchase order no.", key: "po", width: 16 },
  { header: "Line no.", key: "lineNo", type: "number", width: 9 },
  { header: "Type", key: "type", width: 12 },
  { header: "No.", key: "no", width: 14 },
  { header: "Description", key: "description", width: 40 },
  { header: "Supplier SKU", key: "sku", width: 16 },
  { header: "Quantity", key: "qty", type: "number", width: 9 },
  { header: "Direct unit cost", key: "price", type: "money", width: 14 },
  { header: "VAT %", key: "vatRate", type: "number", width: 7 },
  { header: "Line amount excl. VAT", key: "net", type: "money", width: 15 },
  { header: "Line VAT", key: "lineVat", type: "money", width: 12 },
  { header: "Invoice amount excl. VAT", key: "subtotal", type: "money", width: 15 },
  { header: "Invoice VAT", key: "vat", type: "money", width: 12 },
  { header: "Invoice amount incl. VAT", key: "total", type: "money", width: 15 },
  { header: "Post to", key: "postTo", width: 16 },
  { header: "PO no. (matched)", key: "order", width: 16 },
  { header: "GRN no.", key: "grn", width: 16 },
  { header: "PO unit cost", key: "poPrice", type: "money", width: 13 },
  { header: "Received not invoiced", key: "open", type: "number", width: 12 },
];

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

export async function capturesWorkbook(captures: Capture[], opts: { erp: boolean }): Promise<ArrayBuffer> {
  const invoices = captures.map((c) => {
    const d = c.draft;
    const review = reviewDraft(d, { erp: opts.erp });
    const issues = c.status === "failed" ? [c.failure?.message ?? "Couldn't read this PDF."] : c.status === "pushed" ? [] : [...review.blockers, ...(c.failure?.stage === "push" ? [`Last push failed: ${c.failure.message}`] : [])];
    return {
      file: c.fileName,
      status: STATUS[c.status],
      supplier: d.vendorName || d.supplierName,
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
    return d.lines.map((l, i) => ({
      vendorNo: d.vendorNo,
      vendorName: d.vendorName || d.supplierName,
      trn: d.supplierTrn,
      number: d.invoiceNumber,
      date: d.invoiceDate,
      due: d.dueDate,
      currency: d.currency,
      po: d.poNumber,
      lineNo: (i + 1) * 10000,
      type: l.erpType === "item" ? "Item" : l.erpType === "account" ? "G/L Account" : "",
      no: l.erpNo,
      description: l.description,
      sku: l.sku,
      qty: l.qty,
      price: l.unitPrice,
      vatRate: l.vatRate,
      net: l.net,
      lineVat: l.vat,
      subtotal: d.subtotal,
      vat: d.vat,
      total: d.total,
      postTo: d.postTo === "order" ? "Purchase order" : "Purchase invoice",
      order: l.po?.orderNumber ?? "",
      grn: l.po?.receipts.join(", ") ?? "",
      poPrice: l.po?.poPrice ?? null,
      open: l.po?.open ?? null,
    }));
  });

  return workbook([
    { sheetName: "Invoices", columns: INVOICE_COLUMNS, rows: invoices },
    { sheetName: "Lines", columns: LINE_COLUMNS, rows: lines },
  ]);
}
