// Shared shapes for PDF extraction. A PDF becomes the same { headers, rows } table as a
// CSV; everything here is the extra context shown next to it (metadata, checks, method).

/** One positioned run of text. y grows downwards (top of page = 0), like reading order. */
export type TextItem = { str: string; x: number; y: number; w: number; h: number; page: number; rtl?: boolean };

export type PdfPage = { number: number; width: number; height: number; items: TextItem[]; images: number };

export type ColumnRole =
  | "date"
  | "value_date"
  | "description"
  | "reference"
  | "debit"
  | "credit"
  | "amount"
  | "balance"
  | "qty"
  | "unit_price"
  | "sku"
  | "net"
  | "vat_rate"
  | "vat"
  | "total"
  | "other";

export type LayoutColumn = { name: string; role: ColumnRole; x0: number; x1: number };

/** What the layout memory stores per workspace: enough to read the next statement from the same issuer. */
export type LayoutRecipe = {
  version: 1;
  issuerKey: string;
  fingerprint: string;
  kind: PdfKind;
  headerTokens: string[];
  columns: LayoutColumn[];
};

export interface LayoutMemory {
  find(issuerKey: string): LayoutRecipe[] | Promise<LayoutRecipe[]>;
  save(recipe: LayoutRecipe): void | Promise<void>;
}

export type PdfKind = "statement" | "invoice" | "table";
export type PdfMethod = "zatca_xml" | "zatca_qr" | "text" | "ocr";

export type PdfCheck = { id: string; label: string; ok: boolean; detail: string };

export type PdfFileInfo = {
  fileName: string;
  kind: PdfKind;
  method: PdfMethod;
  pages: number;
  /** "remembered" when a saved layout recipe for this issuer was used. */
  layout?: "remembered" | "learned";
  /** Statement or invoice header facts, kept apart from the rows. */
  meta: { label: string; value: string }[];
  checks: PdfCheck[];
  /** Rows set aside: brought/carried forward, totals, repeated headers. */
  skipped: number;
  /** Set when the text came from local OCR of scanned pages: lower confidence, review the rows. */
  ocr?: { pages: number; confidence: number; lowConfidenceRows: number[] };
};

export type InvoiceLine = {
  description?: string;
  sku?: string;
  qty?: number;
  unitPrice?: number;
  net?: number;
  vatRate?: number;
  vat?: number;
  total?: number;
};

export type InvoiceDoc = {
  type: "Invoice" | "Credit note" | "Debit note";
  number?: string;
  date?: string;
  seller?: string;
  sellerVat?: string;
  buyer?: string;
  buyerVat?: string;
  poNumber?: string;
  currency?: string;
  subtotal?: number;
  vat?: number;
  total?: number;
  /** Percent, e.g. 15. */
  vatRate?: number;
  lines: InvoiceLine[];
};

export type StatementMeta = {
  issuer?: string;
  accountNumber?: string;
  iban?: string;
  periodFrom?: string;
  periodTo?: string;
  currency?: string;
  openingBalance?: number;
  closingBalance?: number;
  totalDebits?: number;
  totalCredits?: number;
};
