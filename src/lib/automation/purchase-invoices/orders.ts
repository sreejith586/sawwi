import type { ErpOpenOrderLine, ErpOrderInvoicePlan } from "@/lib/connectors/types";
import { normInvoiceNo, PRICE_TOLERANCE, type Draft, type PoLink } from "./draft";

// Three-way match (D-88): each item line of a supplier invoice → the vendor's purchase order line
// for that item with goods received (GRN) and not yet invoiced. Exact item numbers only, as for
// item matching (D-62). Most invoices print no PO number, so Sawwi searches all the vendor's open
// orders and suggests; the user confirms. Pure and browser-safe: the review page re-runs it when
// the user links a PO by number or picks another order line.

const EPS = 1e-9;

/**
 * Links each item line to an open order line and picks how the invoice posts:
 * - every line linked → "order" (unless the user chose "invoice");
 * - some or none → links kept for the review screen, and the post-to choice left as it was.
 * A PO number printed on the invoice narrows the search to that order.
 */
export function matchOrders(d: Draft, open: ErpOpenOrderLine[]): Draft {
  const printedPo = d.poNumber ? normInvoiceNo(d.poNumber) : "";
  const pool = open
    .filter((o) => o.received - o.invoiced > EPS)
    .filter((o) => !printedPo || normInvoiceNo(o.orderNumber) === printedPo)
    .sort((a, b) => a.orderDate.localeCompare(b.orderDate) || a.orderNumber.localeCompare(b.orderNumber) || a.sequence - b.sequence);
  const used = new Set<string>();

  const lines = d.lines.map((l) => {
    if (l.erpType !== "item" || !l.erpNo || l.qty === null) return { ...l, po: null };
    const candidates = pool.filter((o) => o.itemNumber === l.erpNo && !used.has(o.lineId));
    const open = (o: ErpOpenOrderLine) => o.received - o.invoiced;
    // The line that takes the whole quantity exactly, else the oldest that covers it, else the one with the most open.
    const hit =
      candidates.find((o) => Math.abs(open(o) - l.qty!) < EPS) ??
      candidates.find((o) => open(o) >= l.qty! - EPS) ??
      [...candidates].sort((a, b) => open(b) - open(a))[0];
    if (!hit) return { ...l, po: null };
    used.add(hit.lineId);
    const po: PoLink = { orderNumber: hit.orderNumber, orderId: hit.orderId, lineId: hit.lineId, receipts: hit.receipts, open: open(hit), poPrice: hit.directUnitCost };
    return { ...l, po };
  });

  const all = lines.length > 0 && lines.every((l) => l.po);
  const postTo = d.postTo === "invoice" ? "invoice" : all ? "order" : d.postTo === "order" ? "order" : undefined;
  // Only a printed PO number whose order agrees on every line needs no confirmation.
  const agrees = all && Boolean(printedPo) && lines.every((l) => l.qty! <= l.po!.open + EPS && (l.unitPrice === null || Math.abs(l.unitPrice - l.po!.poPrice) <= l.po!.poPrice * PRICE_TOLERANCE));
  return { ...d, lines, postTo, poConfirmed: agrees || undefined };
}

/** Points one line at another order line (the user's pick); the match then needs confirming again. */
export function pickOrderLine(d: Draft, index: number, o: ErpOpenOrderLine | null): Draft {
  const lines = d.lines.map((l, i) => (i !== index ? l : { ...l, po: o ? { orderNumber: o.orderNumber, orderId: o.orderId, lineId: o.lineId, receipts: o.receipts, open: o.received - o.invoiced, poPrice: o.directUnitCost } : null }));
  return { ...d, lines, poConfirmed: undefined };
}

/** Order lines another invoice line could use instead: same item, something received and not invoiced. */
export const candidatesFor = (itemNo: string, open: ErpOpenOrderLine[]) => open.filter((o) => o.itemNumber === itemNo && o.received - o.invoiced > EPS);

/** What a push against purchase orders sets on each order line (D-88). */
export type OrderInvoicePlan = ErpOrderInvoicePlan;

export function orderPlan(d: Draft): OrderInvoicePlan {
  const byOrder = new Map<string, OrderInvoicePlan[number]>();
  for (const l of d.lines) {
    if (!l.po || l.qty === null || l.unitPrice === null) throw new Error("Every line needs a purchase order line, a quantity and a price.");
    const o = byOrder.get(l.po.orderId) ?? { orderId: l.po.orderId, orderNumber: l.po.orderNumber, vendorNumber: d.vendorNo, lines: [] };
    o.lines.push({ lineId: l.po.lineId, itemNumber: l.erpNo, invoiceQuantity: l.qty, directUnitCost: l.unitPrice });
    byOrder.set(l.po.orderId, o);
  }
  return [...byOrder.values()];
}
