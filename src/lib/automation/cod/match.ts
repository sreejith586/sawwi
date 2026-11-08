import type { ErpInvoiceRef } from "@/lib/connectors/types";
import type { ParcelDraft, RemittanceDraft } from "./remittance";

// Each parcel → its posted sales invoice (D-74): External Document No. (the web order number),
// then the invoice number, then the order number. Exact references only.

const norm = (s: string) => s.trim().toUpperCase();

function findInvoice(ref: string, invoices: ErpInvoiceRef[]): { inv: ErpInvoiceRef; by: NonNullable<ParcelDraft["matchedBy"]> } | undefined {
  const r = norm(ref);
  if (!r) return undefined;
  const byExt = invoices.filter((i) => norm(i.externalDocumentNumber) === r);
  if (byExt.length) return { inv: byExt[0], by: "external_document" };
  const byNo = invoices.find((i) => norm(i.number) === r);
  if (byNo) return { inv: byNo, by: "invoice_number" };
  const byOrder = invoices.find((i) => i.orderNumber && norm(i.orderNumber) === r);
  return byOrder && { inv: byOrder, by: "order_number" };
}

/** What other batches already hold, so a parcel or invoice remitted twice is caught (D-74). */
export type OtherBatches = { awbs: Map<string, string>; invoices: Map<string, string> };

export function matchParcels(d: RemittanceDraft, open: ErpInvoiceRef[], looked: ErpInvoiceRef[], others: OtherBatches): RemittanceDraft {
  return {
    ...d,
    parcels: d.parcels.map((p) => {
      const next: ParcelDraft = { ...p, invoiceNumber: "", customerNumber: "", openAmount: null, invoiceState: "none", matchedBy: undefined, duplicateOf: undefined };
      const hit = findInvoice(p.orderRef, open);
      const closed = hit ? undefined : findInvoice(p.orderRef, looked.filter((i) => i.status !== "Open"));
      const m = hit ?? closed;
      if (m) {
        Object.assign(next, {
          invoiceNumber: m.inv.number,
          customerNumber: m.inv.customerNumber,
          openAmount: hit ? m.inv.remainingAmount : 0,
          invoiceState: hit ? "open" : "paid",
          matchedBy: m.by,
        });
      }
      const dupAwb = p.awb ? others.awbs.get(norm(p.awb)) : undefined;
      const dupInv = next.invoiceNumber ? others.invoices.get(norm(next.invoiceNumber)) : undefined;
      next.duplicateOf = dupAwb ?? dupInv;
      // Sawwi decides only the clear case: an open invoice, not seen in another batch.
      next.action = next.invoiceState === "open" && !next.duplicateOf ? "apply" : null;
      return next;
    }),
  };
}
