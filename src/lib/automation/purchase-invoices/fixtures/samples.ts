// Made-up supplier invoices for the demo store's Automation section and for tests (D-60). They
// are drawn with the PDF test helpers (dev dependencies, never imported by the app);
// scripts/make-purchase-invoice-samples.mts writes them into samples-data.ts.
import { PassThrough } from "node:stream";
import * as PImage from "pureimage";
import { draw, finishScans, newDoc, newScan, type Ctx } from "@/lib/pdf/fixtures/make";
import type { SampleSpec } from "../samples";

export { SAMPLE_SPECS } from "../samples";

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function samplePdf(spec: SampleSpec): Promise<Uint8Array> {
  const { doc, font, bold } = await newDoc();
  const page = doc.addPage([595, 842]);
  const scan = spec.scan ? await newScan(page) : undefined;
  drawInvoice({ page, font, bold, size: 10, scan }, spec);
  if (scan) await finishScans(doc, [{ page, img: scan }]);
  return doc.save({ useObjectStreams: false });
}

/** The invoice as a phone photo would arrive: a JPEG of the page (D-67). */
export async function sampleJpeg(spec: SampleSpec): Promise<{ jpeg: Uint8Array; width: number; height: number }> {
  const { doc, font, bold } = await newDoc();
  const page = doc.addPage([595, 842]);
  const scan = await newScan(page);
  drawInvoice({ page, font, bold, size: 10, scan }, spec);
  const chunks: Buffer[] = [];
  const out = new PassThrough();
  out.on("data", (c: Buffer) => chunks.push(c));
  await PImage.encodeJPEGToStream(scan, out, 85);
  return { jpeg: new Uint8Array(Buffer.concat(chunks)), width: scan.width, height: scan.height };
}

function drawInvoice(ctx: Ctx, spec: SampleSpec) {
  draw({ ...ctx, size: 15 }, 50, [{ text: spec.supplier, x: 40, bold: true }]);
  draw(ctx, 68, [{ text: spec.address, x: 40 }]);
  draw(ctx, 82, [{ text: `TRN: ${spec.trn}`, x: 40 }]);
  draw({ ...ctx, size: 13 }, 115, [{ text: "TAX INVOICE", x: 40, bold: true }]);
  draw(ctx, 140, [{ text: `Invoice No: ${spec.number}`, x: 40 }, { text: "Bill To: Sawwi Demo Trading LLC", x: 320 }]);
  draw(ctx, 154, [{ text: `Invoice Date: ${spec.date}`, x: 40 }, { text: "TRN: 100111222300003", x: 320 }]);
  let y = 154;
  if (spec.due) draw(ctx, (y += 14), [{ text: `Due Date: ${spec.due}`, x: 40 }]);
  if (spec.po) draw(ctx, (y += 14), [{ text: `PO No: ${spec.po}`, x: 40 }]);

  const X =
    spec.layout === "classic"
      ? { description: 40, code: 250, qty: 350, price: 440, amount: 550 }
      : { code: 40, description: 120, qty: 330, price: 430, amount: 550 };
  y = 215;
  draw(ctx, y, [
    { text: "Description", x: X.description, bold: true },
    { text: spec.layout === "classic" ? "SKU" : "Item Code", x: X.code, bold: true },
    { text: spec.layout === "classic" ? "Qty" : "Quantity", x: X.qty, align: "right", bold: true },
    { text: spec.layout === "classic" ? "Unit Price" : "Rate", x: X.price, align: "right", bold: true },
    { text: spec.layout === "classic" ? "Amount" : "Net Amount", x: X.amount, align: "right", bold: true },
  ]);
  let net = 0;
  for (const l of spec.lines) {
    const amount = Math.round(l.qty * l.price * 100) / 100;
    net += amount;
    draw(ctx, (y += 16), [
      { text: l.description, x: X.description },
      ...(l.code ? [{ text: l.code, x: X.code }] : []),
      { text: String(l.qty), x: X.qty, align: "right" as const },
      { text: money(l.price), x: X.price, align: "right" as const },
      { text: money(amount), x: X.amount, align: "right" as const },
    ]);
  }
  const vat = Math.round(net * 5) / 100;
  y += 30;
  draw(ctx, y, [{ text: "Subtotal", x: 400 }, { text: money(net), x: X.amount, align: "right" }]);
  draw(ctx, (y += 16), [{ text: "VAT 5%", x: 400 }, { text: money(vat), x: X.amount, align: "right" }]);
  draw(ctx, (y += 16), [{ text: "Total AED", x: 400, bold: true }, { text: money(net + vat), x: X.amount, align: "right", bold: true }]);
  draw(ctx, 790, [{ text: "Please quote the invoice number with your payment.", x: 40 }]);
}
