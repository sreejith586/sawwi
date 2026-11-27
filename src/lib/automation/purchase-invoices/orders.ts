import type { ErpOpenOrderLine, ErpOrderInvoicePlan, ErpReceipt } from "@/lib/connectors/types";
import { normInvoiceNo, PRICE_TOLERANCE, type Draft, type GrnLink, type PoLink } from "./draft";

// Three-way match (D-88): each item line of a supplier invoice → the vendor's purchase order line
// for that item with goods received (GRN) and not yet invoiced. Exact item numbers only, as for
// item matching (D-62). Most invoices print no PO number, so Sawwi searches all the vendor's open
// orders and suggests; the user confirms. Pure and browser-safe: the review page re-runs it when
// the user links a PO by number or picks another order line.

const EPS = 1e-9;

/**
 * The goods receipt (GRN) each item line is for (D-92). The receipt whose lines best agree with the
 * invoice (same item, then same quantity) is taken first, so one delivery's invoice stays on one
 * GRN; lines it doesn't cover look at the vendor's other receipts, newest first. A GRN number on
 * the invoice, or linked by the user, narrows it to that receipt.
 */
function matchReceipts(d: Draft, receipts: ErpReceipt[]): (GrnLink | null)[] {
  const wanted = d.grnNumber ? normInvoiceNo(d.grnNumber) : "";
  const pool = receipts.filter((r) => !wanted || normInvoiceNo(r.number) === wanted).sort((a, b) => b.postingDate.localeCompare(a.postingDate) || b.number.localeCompare(a.number));
  const items = d.lines.map((l) => (l.erpType === "item" && l.erpNo && l.qty !== null ? l : null));
  const score = (r: ErpReceipt) =>
    items.reduce((sum, l) => {
      const hit = l && r.lines.find((x) => x.itemNumber === l.erpNo);
      return sum + (hit ? 1 + (Math.abs(hit.quantity - l!.qty!) < EPS ? 1 : 0) : 0);
    }, 0);
  const ranked = [...pool].sort((a, b) => score(b) - score(a));
  const used = new Set<string>();
  return items.map((l) => {
    if (!l) return null;
    for (const r of ranked) {
      const options = r.lines.map((x, i) => ({ x, key: `${r.number}#${i}` })).filter(({ x, key }) => x.itemNumber === l.erpNo && !used.has(key));
      const pick = options.find(({ x }) => Math.abs(x.quantity - l.qty!) < EPS) ?? options[0];
      if (pick) {
        used.add(pick.key);
        return { number: r.number, orderNumber: r.orderNumber, postingDate: r.postingDate, quantity: pick.x.quantity };
      }
    }
    return null;
  });
}

/**
 * Links each item line to its GRN and to an open order line, and picks how the invoice posts:
 * - every line linked to an order line → "order" (unless the user chose "invoice");
 * - some or none → links kept for the review screen, and the post-to choice left as it was.
 * A line with a GRN takes its order line from that GRN's purchase order. A PO number printed on
 * (or linked to) the invoice narrows the orders searched.
 */
export function matchOrders(d: Draft, open: ErpOpenOrderLine[], receipts: ErpReceipt[] = []): Draft {
  const printedPo = d.poNumber ? normInvoiceNo(d.poNumber) : "";
  const grns = matchReceipts(d, receipts);
  const pool = open
    .filter((o) => o.received - o.invoiced > EPS)
    .filter((o) => !printedPo || normInvoiceNo(o.orderNumber) === printedPo)
    .sort((a, b) => a.orderDate.localeCompare(b.orderDate) || a.orderNumber.localeCompare(b.orderNumber) || a.sequence - b.sequence);
  const used = new Set<string>();

  const lines = d.lines.map((l, i) => {
    const grn = grns[i];
    if (l.erpType !== "item" || !l.erpNo || l.qty === null) return { ...l, po: null, grn: null };
    const sameItem = pool.filter((o) => o.itemNumber === l.erpNo && !used.has(o.lineId));
    // The GRN's own order first; any open order for the item if that one has nothing left to invoice.
    const onGrnOrder = grn ? sameItem.filter((o) => o.orderNumber === grn.orderNumber) : [];
    const candidates = onGrnOrder.length ? onGrnOrder : sameItem;
    const open = (o: ErpOpenOrderLine) => o.received - o.invoiced;
    // The line that takes the whole quantity exactly, else the oldest that covers it, else the one with the most open.
    const hit =
      candidates.find((o) => Math.abs(open(o) - l.qty!) < EPS) ??
      candidates.find((o) => open(o) >= l.qty! - EPS) ??
      [...candidates].sort((a, b) => open(b) - open(a))[0];
    if (!hit) return { ...l, po: null, grn };
    used.add(hit.lineId);
    const po: PoLink = { orderNumber: hit.orderNumber, orderId: hit.orderId, lineId: hit.lineId, receipts: hit.receipts, open: open(hit), poPrice: hit.directUnitCost };
    return { ...l, po, grn };
  });

  const all = lines.length > 0 && lines.every((l) => l.po);
  const postTo = d.postTo === "invoice" ? "invoice" : all ? "order" : d.postTo === "order" ? "order" : undefined;
  // No confirmation needed only where the invoice names the PO or GRN and every line agrees with it.
  const named = Boolean(printedPo) || Boolean(d.grnNumber);
  const agrees =
    all &&
    named &&
    lines.every(
      (l) =>
        l.qty! <= l.po!.open + EPS &&
        (l.unitPrice === null || Math.abs(l.unitPrice - l.po!.poPrice) <= l.po!.poPrice * PRICE_TOLERANCE) &&
        (!d.grnNumber || (l.grn && Math.abs(l.grn.quantity - l.qty!) < EPS && l.grn.orderNumber === l.po!.orderNumber)),
    );
  return { ...d, lines, postTo, poConfirmed: agrees || undefined };
}

/** Points one line at another GRN line (the user's pick), and its order line at that GRN's order if needed. */
export function pickGrn(d: Draft, index: number, grn: GrnLink | null, open: ErpOpenOrderLine[]): Draft {
  const lines = d.lines.map((l, i) => {
    if (i !== index) return l;
    if (!grn || !l.po || l.po.orderNumber === grn.orderNumber) return { ...l, grn };
    const taken = new Set(d.lines.flatMap((x, j) => (j !== i && x.po ? [x.po.lineId] : [])));
    const o = open.find((x) => x.orderNumber === grn.orderNumber && x.itemNumber === l.erpNo && x.received - x.invoiced > EPS && !taken.has(x.lineId));
    return { ...l, grn, po: o ? { orderNumber: o.orderNumber, orderId: o.orderId, lineId: o.lineId, receipts: o.receipts, open: o.received - o.invoiced, poPrice: o.directUnitCost } : l.po };
  });
  return { ...d, lines, poConfirmed: undefined };
}

/** GRN lines another invoice line could use: same item, any of the receipts read. */
export const grnOptionsFor = (itemNo: string, receipts: ErpReceipt[]): GrnLink[] =>
  receipts.flatMap((r) => r.lines.filter((x) => x.itemNumber === itemNo).map((x) => ({ number: r.number, orderNumber: r.orderNumber, postingDate: r.postingDate, quantity: x.quantity })));

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
