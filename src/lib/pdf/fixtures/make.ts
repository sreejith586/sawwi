// Synthetic PDF fixtures for tests (golden tables live in src/lib/pdf/pdf.test.ts).
// Test-only: pdf-lib, qrcode and pureimage are dev dependencies and nothing in the app imports this.
import { createRequire } from "node:module";
import path from "node:path";
import { PassThrough } from "node:stream";
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import * as PImage from "pureimage";
import QRCode from "qrcode";
import { encodeZatcaQr } from "../zatca";

export type Cell = { text: string; x: number; align?: "left" | "right"; bold?: boolean };
type Canvas = ReturnType<typeof PImage.make>;
/** With `scan`, text is painted onto a page-sized bitmap instead: an image-only "scanned" page. */
export type Ctx = { page: PDFPage; font: PDFFont; bold: PDFFont; size: number; scan?: Canvas };

/** Scan resolution: 2.5 × 72 = 180 dpi, a typical office scan. */
const SCAN_SCALE = 2.5;

export function draw(ctx: Ctx, y: number, cells: Cell[]) {
  for (const c of cells) {
    const font = c.bold ? ctx.bold : ctx.font;
    // Liberation Sans (used for scans) has the same metrics as Helvetica, so alignment matches.
    const width = font.widthOfTextAtSize(c.text, ctx.size);
    const x = c.align === "right" ? c.x - width : c.x;
    if (ctx.scan) {
      const g = ctx.scan.getContext("2d");
      g.fillStyle = "#111111";
      g.font = `${ctx.size * SCAN_SCALE}pt ${c.bold ? "ScanSansBold" : "ScanSans"}`;
      g.fillText(c.text, x * SCAN_SCALE, y * SCAN_SCALE);
    } else ctx.page.drawText(c.text, { x, y: ctx.page.getHeight() - y, size: ctx.size, font });
  }
}

let fontsLoaded: Promise<void> | undefined;
function loadScanFonts() {
  fontsLoaded ??= (async () => {
    const dir = path.join(path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")), "standard_fonts");
    await PImage.registerFont(path.join(dir, "LiberationSans-Regular.ttf"), "ScanSans").load();
    await PImage.registerFont(path.join(dir, "LiberationSans-Bold.ttf"), "ScanSansBold").load();
  })();
  return fontsLoaded;
}

export async function newScan(page: PDFPage): Promise<Canvas> {
  await loadScanFonts();
  const img = PImage.make(Math.round(page.getWidth() * SCAN_SCALE), Math.round(page.getHeight() * SCAN_SCALE));
  const g = img.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, img.width, img.height);
  return img;
}

/** Places each page's bitmap as a full-page image: the PDF has no text layer at all. */
export async function finishScans(doc: PDFDocument, scans: { page: PDFPage; img: Canvas }[]) {
  for (const { page, img } of scans) {
    const chunks: Buffer[] = [];
    const out = new PassThrough();
    out.on("data", (c: Buffer) => chunks.push(c));
    await PImage.encodePNGToStream(img, out);
    const png = await doc.embedPng(Buffer.concat(chunks));
    page.drawImage(png, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  }
}

export async function newDoc() {
  const doc = await PDFDocument.create();
  doc.setProducer("Sawwi test fixtures");
  doc.setCreationDate(new Date("2026-02-01T00:00:00Z"));
  doc.setModificationDate(new Date("2026-02-01T00:00:00Z"));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, font, bold };
}

// ─── Bank statements ──────────────────────────────────────────────────────

export type Txn = { date: string; description: string[]; reference?: string; debit?: number; credit?: number };

const COLS = { date: 40, description: 105, reference: 300, debit: 420, credit: 490, balance: 565 };
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function statementHeader(ctx: Ctx, y: number) {
  draw(ctx, y, [
    { text: "Date", x: COLS.date, bold: true },
    { text: "Description", x: COLS.description, bold: true },
    { text: "Reference", x: COLS.reference, bold: true },
    { text: "Debit", x: COLS.debit, align: "right", bold: true },
    { text: "Credit", x: COLS.credit, align: "right", bold: true },
    { text: "Balance", x: COLS.balance, align: "right", bold: true },
  ]);
}

/**
 * A text-layer bank statement. `rowsPerPage` splits it over pages with "Balance carried
 * forward" / "Balance brought forward" lines and a repeated header on every page.
 */
export async function statementPdf(opts: {
  opening: number;
  txns: Txn[];
  rowsPerPage?: number;
  /** Adds this much to one printed balance (row index) to make the running-balance check fail. */
  misprint?: { row: number; by: number };
  printTotals?: boolean;
  /** Paint the pages as images (a scanned statement, for OCR). */
  scan?: boolean;
}): Promise<Uint8Array> {
  const { doc, font, bold } = await newDoc();
  const scans: { page: PDFPage; img: Canvas }[] = [];
  const pagesNeeded = Math.ceil(opts.txns.length / (opts.rowsPerPage ?? opts.txns.length));
  for (let i = 0; opts.scan && i < pagesNeeded; i++) {
    const page = doc.addPage([595, 842]);
    scans.push({ page, img: await newScan(page) });
  }
  const perPage = opts.rowsPerPage ?? opts.txns.length;
  const chunks: Txn[][] = [];
  for (let i = 0; i < opts.txns.length; i += perPage) chunks.push(opts.txns.slice(i, i + perPage));
  let balance = opts.opening;
  let index = 0;
  const totals = { debit: 0, credit: 0 };

  chunks.forEach((chunk, p) => {
    const page = opts.scan ? scans[p].page : doc.addPage([595, 842]);
    const ctx: Ctx = { page, font, bold, size: 9, scan: scans[p]?.img };
    let y = 50;
    if (p === 0) {
      draw({ ...ctx, size: 14 }, y, [{ text: "Gulf Example Bank PJSC", x: 40, bold: true }]);
      draw(ctx, (y += 22), [{ text: "Statement of Account", x: 40 }]);
      draw(ctx, (y += 16), [{ text: "Account Number: 1012345678901", x: 40 }, { text: "Currency: AED", x: 380 }]);
      draw(ctx, (y += 14), [{ text: "IBAN: AE07 0331 0123 4567 8901 234", x: 40 }]);
      draw(ctx, (y += 14), [{ text: "Period: 01/01/2026 to 31/01/2026", x: 40 }]);
    } else {
      draw(ctx, y, [{ text: "Gulf Example Bank PJSC", x: 40, bold: true }, { text: "Account Number: 1012345678901", x: 380 }]);
    }
    statementHeader(ctx, (y += 30));
    y += 16;
    draw(ctx, y, [
      { text: p === 0 ? "01/01/2026" : chunk[0].date, x: COLS.date },
      { text: p === 0 ? "Opening balance" : "Balance brought forward", x: COLS.description },
      { text: money(balance), x: COLS.balance, align: "right" },
    ]);
    for (const t of chunk) {
      balance = Math.round((balance + (t.credit ?? 0) - (t.debit ?? 0)) * 100) / 100;
      totals.debit += t.debit ?? 0;
      totals.credit += t.credit ?? 0;
      const printed = opts.misprint?.row === index ? balance + opts.misprint.by : balance;
      y += 14;
      draw(ctx, y, [
        { text: t.date, x: COLS.date },
        { text: t.description[0], x: COLS.description },
        ...(t.reference ? [{ text: t.reference, x: COLS.reference }] : []),
        ...(t.debit ? [{ text: money(t.debit), x: COLS.debit, align: "right" as const }] : []),
        ...(t.credit ? [{ text: money(t.credit), x: COLS.credit, align: "right" as const }] : []),
        { text: money(printed), x: COLS.balance, align: "right" },
      ]);
      for (const more of t.description.slice(1)) draw(ctx, (y += 11), [{ text: more, x: COLS.description }]);
      index++;
    }
    const last = p === chunks.length - 1;
    y += 14;
    draw(ctx, y, [
      { text: last ? "Closing balance" : "Balance carried forward", x: COLS.description, bold: true },
      { text: money(balance), x: COLS.balance, align: "right", bold: true },
    ]);
    if (last && opts.printTotals) {
      draw(ctx, (y += 14), [
        { text: "Total", x: COLS.description, bold: true },
        { text: money(totals.debit), x: COLS.debit, align: "right", bold: true },
        { text: money(totals.credit), x: COLS.credit, align: "right", bold: true },
      ]);
    }
    draw(ctx, 810, [{ text: `Page ${p + 1} of ${chunks.length}`, x: 270 }]);
  });
  await finishScans(doc, scans);
  return doc.save();
}

export const JANUARY: Txn[] = [
  { date: "02/01/2026", description: ["NOON PAYOUT 88231"], reference: "FT26002ABC", credit: 2500 },
  { date: "03/01/2026", description: ["POS PURCHASE OFFICE SUPPLIES", "MARINA BRANCH DUBAI"], debit: 350.75 },
  { date: "05/01/2026", description: ["AMAZON.AE SETTLEMENT"], reference: "FT26005XYZ", credit: 1200 },
  { date: "07/01/2026", description: ["BANK CHARGES"], debit: 26.25 },
];

export const QUARTER: Txn[] = Array.from({ length: 23 }, (_, i) => {
  const day = String((i % 28) + 1).padStart(2, "0");
  const month = String(Math.floor(i / 8) + 1).padStart(2, "0");
  return i % 3 === 0
    ? { date: `${day}/${month}/2026`, description: [`SUPPLIER PAYMENT ${1000 + i}`], reference: `TT${5000 + i}`, debit: 1000 + i * 10.5 }
    : { date: `${day}/${month}/2026`, description: [`NOON PAYOUT ${7000 + i}`, ...(i % 4 === 1 ? ["SETTLEMENT REF NP-" + i] : [])], credit: 2000 + i * 3.25 };
});

// ─── Invoices ─────────────────────────────────────────────────────────────

export type InvoiceLineSpec = { description: string; sku: string; qty: number; price: number };

export const MOUSE_LINES: InvoiceLineSpec[] = [
  { description: "Wireless Mouse", sku: "SKU-001", qty: 10, price: 25 },
  { description: "USB-C Cable 1m", sku: "SKU-002", qty: 20, price: 12.5 },
  { description: "Laptop Stand Aluminium", sku: "SKU-003", qty: 5, price: 90 },
];

export async function invoicePdf(opts: { number: string; date: string; po?: string; lines: InvoiceLineSpec[]; vatRate?: number; vatOverride?: number; scan?: boolean }) {
  const { doc, font, bold } = await newDoc();
  const page = doc.addPage([595, 842]);
  const scan = opts.scan ? await newScan(page) : undefined;
  const ctx: Ctx = { page, font, bold, size: 10, scan };
  const rate = opts.vatRate ?? 5;
  draw({ ...ctx, size: 15 }, 50, [{ text: "Example Trading LLC", x: 40, bold: true }]);
  draw(ctx, 68, [{ text: "Office 12, Business Bay, Dubai, UAE", x: 40 }]);
  draw(ctx, 82, [{ text: "TRN: 100123456700003", x: 40 }]);
  draw({ ...ctx, size: 13 }, 115, [{ text: "TAX INVOICE", x: 40, bold: true }]);
  draw(ctx, 140, [{ text: `Invoice No: ${opts.number}`, x: 40 }, { text: "Bill To: Example Retail FZE", x: 320 }]);
  draw(ctx, 154, [{ text: `Invoice Date: ${opts.date}`, x: 40 }, { text: "TRN: 100987654300003", x: 320 }]);
  if (opts.po) draw(ctx, 168, [{ text: `PO No: ${opts.po}`, x: 40 }]);
  const X = { description: 40, sku: 250, qty: 350, price: 440, amount: 550 };
  draw(ctx, 200, [
    { text: "Description", x: X.description, bold: true },
    { text: "SKU", x: X.sku, bold: true },
    { text: "Qty", x: X.qty, align: "right", bold: true },
    { text: "Unit Price", x: X.price, align: "right", bold: true },
    { text: "Amount", x: X.amount, align: "right", bold: true },
  ]);
  let y = 200;
  let net = 0;
  for (const l of opts.lines) {
    const amount = Math.round(l.qty * l.price * 100) / 100;
    net += amount;
    draw(ctx, (y += 16), [
      { text: l.description, x: X.description },
      { text: l.sku, x: X.sku },
      { text: String(l.qty), x: X.qty, align: "right" },
      { text: money(l.price), x: X.price, align: "right" },
      { text: money(amount), x: X.amount, align: "right" },
    ]);
  }
  const vat = opts.vatOverride ?? Math.round(net * rate) / 100;
  y += 30;
  draw(ctx, y, [{ text: "Subtotal", x: 400 }, { text: money(net), x: X.amount, align: "right" }]);
  draw(ctx, (y += 16), [{ text: `VAT ${rate}%`, x: 400 }, { text: money(vat), x: X.amount, align: "right" }]);
  draw(ctx, (y += 16), [{ text: "Total AED", x: 400, bold: true }, { text: money(net + vat), x: X.amount, align: "right", bold: true }]);
  draw(ctx, 790, [{ text: "Thank you for your business.", x: 40 }]);
  if (scan) await finishScans(doc, [{ page, img: scan }]);
  return doc.save();
}

// ─── ZATCA ────────────────────────────────────────────────────────────────

export const ZATCA_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>SME00062</cbc:ID>
  <cbc:UUID>6f4d20e0-6bfe-4a80-9389-7dabe6620f12</cbc:UUID>
  <cbc:IssueDate>2026-01-20</cbc:IssueDate>
  <cbc:IssueTime>16:17:44</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="0100000">388</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>
  <cac:OrderReference><cbc:ID>PO-4410</cbc:ID></cac:OrderReference>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyTaxScheme><cbc:CompanyID>300075588700003</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>شركة المثال للتجارة &amp; Co</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyTaxScheme><cbc:CompanyID>310122393500003</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>Example Retail Co</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="SAR">60.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="SAR">60.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="SAR">400.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="SAR">60.00</cbc:TaxAmount>
      <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>15.00</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="SAR">400.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="SAR">400.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="SAR">460.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="SAR">460.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="PCE">4</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="SAR">300.00</cbc:LineExtensionAmount>
    <cac:TaxTotal><cbc:TaxAmount currencyID="SAR">45.00</cbc:TaxAmount><cbc:RoundingAmount currencyID="SAR">345.00</cbc:RoundingAmount></cac:TaxTotal>
    <cac:Item><cbc:Name>قهوة عربية 500g</cbc:Name><cac:SellersItemIdentification><cbc:ID>COF-500</cbc:ID></cac:SellersItemIdentification>
      <cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>15.00</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="SAR">75.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
  <cac:InvoiceLine>
    <cbc:ID>2</cbc:ID>
    <cbc:InvoicedQuantity unitCode="PCE">2</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="SAR">100.00</cbc:LineExtensionAmount>
    <cac:TaxTotal><cbc:TaxAmount currencyID="SAR">15.00</cbc:TaxAmount><cbc:RoundingAmount currencyID="SAR">115.00</cbc:RoundingAmount></cac:TaxTotal>
    <cac:Item><cbc:Name>Dates Gift Box</cbc:Name><cac:SellersItemIdentification><cbc:ID>DAT-01</cbc:ID></cac:SellersItemIdentification>
      <cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>15.00</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="SAR">50.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>`;

export const ZATCA_QR = encodeZatcaQr({ seller: "Example Trading Co", vatNumber: "300075588700003", timestamp: "2026-01-20T16:17:44Z", total: 460, vat: 60 });

async function qrImage(doc: PDFDocument, page: PDFPage, payload: string, x: number, yTop: number) {
  const png = await QRCode.toBuffer(payload, { margin: 2, scale: 4, errorCorrectionLevel: "M" });
  const img = await doc.embedPng(png);
  page.drawImage(img, { x, y: page.getHeight() - yTop - 110, width: 110, height: 110 });
}

/** A PDF/A-3-style ZATCA invoice: a printed summary page with the UBL XML attached and the QR drawn. */
export async function zatcaPdf(opts: { attachXml?: boolean; text?: boolean } = {}) {
  const { doc, font, bold } = await newDoc();
  const page = doc.addPage([595, 842]);
  const ctx: Ctx = { page, font, bold, size: 10 };
  if (opts.text !== false) {
    draw({ ...ctx, size: 14 }, 50, [{ text: "Example Trading Co", x: 40, bold: true }]);
    draw(ctx, 70, [{ text: "Simplified Tax Invoice", x: 40 }]);
    draw(ctx, 86, [{ text: "Invoice No: SME00062", x: 40 }]);
  }
  await qrImage(doc, page, ZATCA_QR, 440, 40);
  if (opts.attachXml !== false) {
    await doc.attach(new TextEncoder().encode(ZATCA_XML), "SME00062.xml", {
      mimeType: "text/xml",
      description: "ZATCA e-invoice (UBL 2.1)",
      creationDate: new Date("2026-01-20T16:17:44Z"),
      modificationDate: new Date("2026-01-20T16:17:44Z"),
    });
  }
  return doc.save();
}

/** A scanned page with nothing readable on it: a blank sheet. */
export async function blankScanPdf() {
  const { doc } = await newDoc();
  const page = doc.addPage([595, 842]);
  await finishScans(doc, [{ page, img: await newScan(page) }]);
  return doc.save();
}

/** A scan with more pages than Sawwi OCRs at once (each page holds a small image, never OCR'd). */
export async function longScanPdf(pages: number) {
  const { doc } = await newDoc();
  const png = await doc.embedPng(await QRCode.toBuffer("page", { scale: 1 }));
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]).drawImage(png, { x: 0, y: 0, width: 595, height: 842 });
  return doc.save();
}

/** A minimal PDF encrypted with a user password (standard security handler, RC4 40-bit). */
export function passwordPdf(): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>",
    `<< /Filter /Standard /V 1 /R 2 /O <${"a1".repeat(32)}> /U <${"b2".repeat(32)}> /P -44 >>`,
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 4 0 R /ID [<${"0f".repeat(16)}> <${"0f".repeat(16)}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}
