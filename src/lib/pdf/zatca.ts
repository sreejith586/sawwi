import { child, children, parseXml, text, type XmlNode } from "./xml";
import type { InvoiceDoc, InvoiceLine } from "./types";

// KSA ZATCA e-invoices: PDF/A-3 with the UBL 2.1 XML attached (exact values), and a QR
// code holding a base64 TLV with seller, VAT number, timestamp, total and VAT.

export function looksLikeUbl(xml: string): boolean {
  return /<([\w-]+:)?(Invoice|CreditNote)\b/.test(xml) && /oasis:names:specification:ubl|urn:oasis/i.test(xml);
}

const num = (s: string | undefined) => {
  if (s === undefined) return undefined;
  const n = Number(s.trim());
  return Number.isFinite(n) ? n : undefined;
};

function party(node: XmlNode | undefined) {
  const p = child(node, "Party");
  return {
    name: text(p, "PartyLegalEntity", "RegistrationName") ?? text(p, "PartyName", "Name"),
    vat: text(p, "PartyTaxScheme", "CompanyID"),
  };
}

/** UBL invoice type codes: 388 invoice, 381 credit note, 383 debit note. */
function docType(root: XmlNode): InvoiceDoc["type"] {
  if (root.name === "CreditNote") return "Credit note";
  const code = text(root, "InvoiceTypeCode");
  return code === "381" ? "Credit note" : code === "383" ? "Debit note" : "Invoice";
}

export function parseUblInvoice(xml: string): InvoiceDoc | undefined {
  const root = parseXml(xml);
  if (!root || (root.name !== "Invoice" && root.name !== "CreditNote")) return undefined;
  const currency = text(root, "DocumentCurrencyCode");
  const totals = child(root, "LegalMonetaryTotal");
  // ZATCA invoices carry two TaxTotal blocks; the one with subtotals is in the document currency.
  const taxTotals = children(root, "TaxTotal");
  const taxTotal = taxTotals.find((t) => children(t, "TaxSubtotal").length > 0) ?? taxTotals[0];
  const rates = new Set(children(taxTotal, "TaxSubtotal").map((s) => num(text(s, "TaxCategory", "Percent"))).filter((r) => r !== undefined && r > 0));
  const supplier = party(child(root, "AccountingSupplierParty"));
  const customer = party(child(root, "AccountingCustomerParty"));

  const lines: InvoiceLine[] = [...children(root, "InvoiceLine"), ...children(root, "CreditNoteLine")].map((l) => {
    const item = child(l, "Item");
    const net = num(text(l, "LineExtensionAmount"));
    const vat = num(text(l, "TaxTotal", "TaxAmount"));
    return {
      description: text(item, "Name") ?? text(item, "Description"),
      sku: text(item, "SellersItemIdentification", "ID") ?? text(item, "StandardItemIdentification", "ID"),
      qty: num(text(l, "InvoicedQuantity") ?? text(l, "CreditedQuantity")),
      unitPrice: num(text(l, "Price", "PriceAmount")),
      net,
      vatRate: num(text(item, "ClassifiedTaxCategory", "Percent")),
      vat,
      total: num(text(l, "TaxTotal", "RoundingAmount")) ?? (net !== undefined && vat !== undefined ? round2(net + vat) : undefined),
    };
  });

  return {
    type: docType(root),
    number: text(root, "ID"),
    date: text(root, "IssueDate"),
    seller: supplier.name,
    sellerVat: supplier.vat,
    buyer: customer.name,
    buyerVat: customer.vat,
    poNumber: text(root, "OrderReference", "ID"),
    currency,
    subtotal: num(text(totals, "TaxExclusiveAmount")) ?? num(text(totals, "LineExtensionAmount")),
    vat: num(text(taxTotal, "TaxAmount")),
    total: num(text(totals, "TaxInclusiveAmount")) ?? num(text(totals, "PayableAmount")),
    vatRate: rates.size === 1 ? [...rates][0] : undefined,
    lines,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export type ZatcaQr = { seller: string; vatNumber: string; timestamp: string; total: number; vat: number };

/** Decodes the ZATCA QR payload: base64 of tag (1 byte), length (1 byte), UTF-8 value. */
export function decodeZatcaQr(payload: string): ZatcaQr | undefined {
  const b64 = payload.trim();
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64) || b64.length < 20) return undefined;
  const bytes = Buffer.from(b64, "base64");
  const fields = new Map<number, string>();
  for (let i = 0; i + 2 <= bytes.length; ) {
    const tag = bytes[i];
    const len = bytes[i + 1];
    if (i + 2 + len > bytes.length) return undefined;
    // Tags 6–9 (phase 2) hold binary hashes and signatures; only 1–5 are text.
    if (tag >= 1 && tag <= 5) fields.set(tag, bytes.subarray(i + 2, i + 2 + len).toString("utf8"));
    i += 2 + len;
  }
  const total = num(fields.get(4));
  const vat = num(fields.get(5));
  if (!fields.get(1) || !fields.get(2) || !fields.get(3) || total === undefined || vat === undefined) return undefined;
  return { seller: fields.get(1)!, vatNumber: fields.get(2)!, timestamp: fields.get(3)!, total, vat };
}

/** Builds a ZATCA TLV payload (used by tests and fixtures). */
export function encodeZatcaQr(q: ZatcaQr): string {
  const parts = [q.seller, q.vatNumber, q.timestamp, q.total.toFixed(2), q.vat.toFixed(2)].map((v, i) => {
    const value = Buffer.from(v, "utf8");
    return Buffer.concat([Buffer.from([i + 1, value.length]), value]);
  });
  return Buffer.concat(parts).toString("base64");
}
