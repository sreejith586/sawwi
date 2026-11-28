import { normInvoiceNo, type Draft, type LineType, type PostTo } from "./draft";
import { matchOrders } from "./orders";
import * as service from "./service";
import * as store from "./store";
import type { Capture } from "./store";

// Single-invoice operations the chat agent calls (D-96), on top of the service. Each one finds the
// invoice in the workspace, changes its draft only (nothing leaves Sawwi), and saves through
// `saveEdits`, so any approval is withdrawn and the checks run again, as for an edit on the page.

export class AssistError extends Error {}

/** An invoice by id, or by its number (case, spaces, dashes and leading zeros ignored), or its file name. */
export async function findInvoice(orgKey: string, ref: string): Promise<Capture> {
  const all = await store.listCaptures(orgKey);
  const r = ref.trim();
  const byId = all.find((c) => c.id === r);
  if (byId) return byId;
  const n = normInvoiceNo(r);
  const hits = all.filter((c) => (c.draft.invoiceNumber && normInvoiceNo(c.draft.invoiceNumber) === n) || c.fileName.toLowerCase() === r.toLowerCase() || normInvoiceNo(c.fileName.replace(/\.pdf$/i, "")) === n);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new AssistError(`More than one invoice matches "${r}": ${hits.map((h) => `${h.draft.invoiceNumber || h.fileName} (${h.draft.supplierName || "unknown supplier"}, id ${h.id})`).join("; ")}. Use the id.`);
  throw new AssistError(`No invoice "${r}" in this workspace.`);
}

const editable = (c: Capture) => {
  if (c.status === "pushed" || c.status === "pushing") throw new AssistError(`${c.draft.invoiceNumber || c.fileName} was already sent to the ERP and can't be changed.`);
  if (c.status === "failed") throw new AssistError(`${c.fileName} hasn't been read yet. Retry it, or type it in on its page.`);
};

/** Links a GRN by number and matches the invoice against it and its order. */
export async function linkGrn(orgKey: string, ref: string, grnNumber: string) {
  const c = await findInvoice(orgKey, ref);
  editable(c);
  const pulled = await service.pullReceipt(orgKey, c.id, grnNumber);
  const vendor = await service.matchDataFor(orgKey, c.draft);
  const draft = matchOrders({ ...c.draft, grnNumber: grnNumber.trim(), postTo: c.draft.postTo === "invoice" ? undefined : c.draft.postTo, poConfirmed: undefined }, [...vendor.lines, ...pulled.lines], [...vendor.receipts, ...pulled.receipts]);
  return service.saveEdits(orgKey, c.id, draft);
}

/** Links a PO by number and matches the invoice against it. */
export async function linkPo(orgKey: string, ref: string, poNumber: string) {
  const c = await findInvoice(orgKey, ref);
  editable(c);
  const lines = await service.pullOrder(orgKey, c.id, poNumber);
  const vendor = await service.matchDataFor(orgKey, c.draft);
  const draft = matchOrders({ ...c.draft, poNumber: poNumber.trim(), postTo: undefined, poConfirmed: undefined }, [...vendor.lines, ...lines], vendor.receipts);
  return service.saveEdits(orgKey, c.id, draft);
}

/** Searches the vendor's GRNs and open POs again, as "Search all again" on the page. */
export async function matchAgain(orgKey: string, ref: string) {
  const c = await findInvoice(orgKey, ref);
  editable(c);
  if (!c.draft.vendorNo) throw new AssistError(`${c.draft.invoiceNumber || c.fileName} has no ERP vendor yet; pick one first.`);
  const { lines, receipts } = await service.matchDataFor(orgKey, { ...c.draft, grnNumber: undefined });
  const draft = matchOrders({ ...c.draft, grnNumber: undefined, postTo: c.draft.postTo === "invoice" ? undefined : c.draft.postTo, poConfirmed: undefined }, lines, receipts);
  return service.saveEdits(orgKey, c.id, draft);
}

/** Codes one line to an ERP item or G/L account that exists in the target's master data. */
export async function codeLine(orgKey: string, ref: string, line: number, type: LineType, no: string) {
  const c = await findInvoice(orgKey, ref);
  editable(c);
  const target = await service.currentTarget(orgKey);
  if (!target) throw new AssistError("Choose the Business Central connection first.");
  const md = await service.masterData(orgKey, target.connectionId);
  const list = type === "item" ? md?.items : md?.accounts;
  const hit = list?.find((x) => x.number.toLowerCase() === no.trim().toLowerCase());
  if (!hit) throw new AssistError(`No ${type === "item" ? "item" : "G/L account"} ${no} in Business Central.`);
  const i = line - 1;
  if (!Number.isInteger(line) || i < 0 || i >= c.draft.lines.length) throw new AssistError(`${c.draft.invoiceNumber} has lines 1 to ${c.draft.lines.length}.`);
  const lines = c.draft.lines.map((l, j) => (j === i ? { ...l, erpType: type, erpNo: hit.number, matchedBy: "user" as const, po: null, grn: null } : l));
  return service.saveEdits(orgKey, c.id, { ...c.draft, lines, poConfirmed: undefined });
}

/** Posts against the purchase order, or as a standalone purchase invoice. */
export async function setPostTo(orgKey: string, ref: string, postTo: PostTo) {
  const c = await findInvoice(orgKey, ref);
  editable(c);
  if (postTo === "order" && !c.draft.lines.some((l) => l.po)) throw new AssistError(`${c.draft.invoiceNumber} has no lines on a purchase order.`);
  const draft: Draft = { ...c.draft, postTo, poConfirmed: postTo === "order" ? c.draft.poConfirmed : undefined };
  return service.saveEdits(orgKey, c.id, draft);
}

/** The user's sign-off on the GRN and PO lines shown (D-88, D-92); only after their confirmation in the chat. */
export async function confirmMatch(orgKey: string, ref: string) {
  const c = await findInvoice(orgKey, ref);
  editable(c);
  if (c.draft.postTo !== "order" || !c.draft.lines.some((l) => l.po)) throw new AssistError(`${c.draft.invoiceNumber} isn't matched to a purchase order.`);
  return service.saveEdits(orgKey, c.id, { ...c.draft, poConfirmed: true });
}
