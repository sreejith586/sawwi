import { createHash, randomUUID } from "node:crypto";
import { isDemoOrg } from "@/lib/demo/demo";
import { deleteFiles, putFile } from "@/lib/files/storage";
import { demoConnectionId } from "@/lib/connectors/mock";
import { connectorById } from "@/lib/connectors/registry";
import { liveDeps, openConnection } from "@/lib/connectors/service";
import { listConnections } from "@/lib/connectors/store";
import { ConnectorError, type ConnectorDeps } from "@/lib/connectors/types";
import { extractPdf, PdfInputError } from "@/lib/pdf";
import * as runStore from "@/lib/runs/store";
import { addDays, daysBetween, draftFromInvoice, normInvoiceNo, reviewDraft, type Draft, type Review } from "./draft";
import { applyMatches, learnFromDraft, type MasterData } from "./matching";
import { samplePdfBytes, sampleSpec } from "./samples";
import * as store from "./store";
import type { Capture, CaptureStatus } from "./store";

// Purchase invoice capture (D-60–D-66): PDF → draft → review → approve → CSV or a draft
// purchase invoice in the ERP. Everything here is scoped to one workspace (org key).

export class CaptureError extends Error {}

/** The confirmation is for exactly this content, to exactly this target (D-64, D-66). */
export function draftHash(d: Draft, target: string): string {
  return createHash("sha256").update(JSON.stringify({ d, target })).digest("hex").slice(0, 32);
}

const MASTER_TTL_MS = 60 * 60_000;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const pdfKey = (id: string) => `automation/purchase-invoices/${id}.pdf`;

// ─── Push targets ──────────────────────────────────────────────────────────

export type PushTarget = { connectionId: string; label: string };

/** Connections whose connector can write purchase invoices. The demo store has its mock Business Central. */
export async function pushTargets(orgKey: string): Promise<PushTarget[]> {
  if (isDemoOrg(orgKey)) return [{ connectionId: demoConnectionId("business-central"), label: "Business Central: Sawwi Demo Trading LLC (Sandbox, mock)" }];
  return (await listConnections(orgKey)).flatMap((c) => {
    const connector = connectorById(c.provider);
    return connector?.purchaseInvoices ? [{ connectionId: c.id, label: `${connector.label}: ${c.accountLabel}` }] : [];
  });
}

/** The chosen target if it still exists, else the only one, else none. */
export async function currentTarget(orgKey: string): Promise<PushTarget | undefined> {
  const targets = await pushTargets(orgKey);
  const chosen = await store.getTarget(orgKey);
  if (chosen === "none") return undefined;
  return targets.find((t) => t.connectionId === chosen) ?? (targets.length === 1 ? targets[0] : undefined);
}

export async function chooseTarget(orgKey: string, connectionId: string | null) {
  if (connectionId && !(await pushTargets(orgKey)).some((t) => t.connectionId === connectionId)) throw new CaptureError("That connection can't take purchase invoices.");
  await store.setTarget(orgKey, connectionId ?? "none");
}

async function writer(orgKey: string, connectionId: string, deps: ConnectorDeps) {
  const c = await openConnection(orgKey, connectionId, deps);
  const w = c.connector.purchaseInvoices;
  if (!w) throw new ConnectorError(`${c.connector.label} can't take purchase invoices.`);
  return { ...c, w };
}

/** Vendors, items and accounts, cached for an hour per connection (D-62). Undefined if the ERP can't be read. */
export async function masterData(orgKey: string, connectionId: string, opts: { refresh?: boolean; deps?: ConnectorDeps } = {}): Promise<MasterData | undefined> {
  const cached = await store.getMasterData(orgKey, connectionId);
  if (cached && !opts.refresh && Date.now() - Date.parse(cached.fetchedAt) < MASTER_TTL_MS) return cached;
  const { w, credentials, deps } = await writer(orgKey, connectionId, opts.deps ?? liveDeps);
  const md: MasterData = { ...(await w.masterData(credentials, deps)), fetchedAt: new Date().toISOString() };
  await store.saveMasterData(orgKey, connectionId, md);
  return md;
}

async function masterDataOrCached(orgKey: string, connectionId: string | undefined, deps?: ConnectorDeps) {
  if (!connectionId) return undefined;
  try {
    return await masterData(orgKey, connectionId, { deps });
  } catch {
    // The ERP is down or the connection needs attention: match later, from the review screen.
    return store.getMasterData(orgKey, connectionId);
  }
}

// ─── Capture ───────────────────────────────────────────────────────────────

export const statusFor = (d: Draft, erp: boolean): CaptureStatus => (reviewDraft(d, { erp }).blockers.length ? "needs_review" : "ready");

export type CaptureResult = { capture: Capture; existing: boolean };

/** One PDF → one draft. The same file again opens the draft it already made (D-63). */
export async function capturePdf(
  orgKey: string,
  userId: string | null,
  file: { name: string; bytes: Uint8Array },
  opts: { sample?: boolean; countries?: string[]; deps?: ConnectorDeps } = {},
): Promise<CaptureResult> {
  if (!file.name.toLowerCase().endsWith(".pdf")) throw new CaptureError(`${file.name}: upload the supplier invoice as a PDF.`);
  if (file.bytes.length > MAX_PDF_BYTES) throw new CaptureError(`${file.name} is over 10 MB. Upload one invoice per PDF.`);
  const fileHash = createHash("sha256").update(file.bytes).digest("hex");
  const seen = await store.findByHash(orgKey, fileHash);
  if (seen) return { capture: seen, existing: true };

  let table: Awaited<ReturnType<typeof extractPdf>>;
  try {
    table = await extractPdf(file.name, file.bytes, {
      grain: "line",
      countries: opts.countries,
      layouts: { find: (issuer) => runStore.getPdfLayouts(orgKey, issuer), save: (recipe) => runStore.savePdfLayout(orgKey, recipe) },
    });
  } catch (error) {
    if (error instanceof PdfInputError) throw new CaptureError(`${file.name}: ${error.message}`);
    throw error;
  }
  if (!table.invoice || table.info.kind !== "invoice") throw new CaptureError(`${file.name} doesn't look like an invoice. Upload the supplier's tax invoice PDF.`);

  const base = draftFromInvoice(table.invoice);
  const issuerKey = table.issuer ?? (base.supplierTrn ? `trn:${base.supplierTrn}` : `name:${base.supplierName.toLowerCase()}`);
  const profile = await store.getProfile(orgKey, issuerKey, base.supplierTrn);
  const target = await currentTarget(orgKey);
  const md = await masterDataOrCached(orgKey, target?.connectionId, opts.deps);
  const draft = applyMatches(base, md, profile, addDays);

  const id = randomUUID();
  const storedPath = pdfKey(id);
  await putFile(storedPath, file.bytes, "application/pdf");
  const capture = await store.insertCapture({
    id,
    orgKey,
    fileName: file.name.slice(0, 200),
    fileHash,
    storedPath,
    issuerKey,
    status: statusFor(draft, Boolean(target)),
    draft,
    source: {
      method: table.info.method,
      pages: table.info.pages,
      layout: table.info.layout,
      checks: table.info.checks,
      ocr: table.info.ocr ? { pages: table.info.ocr.pages, confidence: table.info.ocr.confidence } : undefined,
      sample: opts.sample || undefined,
    },
    createdBy: userId,
  });
  return { capture, existing: false };
}

/** The demo's built-in sample invoices (D-60), read through the same path as an upload. */
export async function captureSample(orgKey: string, userId: string | null, sampleId: string, opts: { countries?: string[]; deps?: ConnectorDeps } = {}) {
  const bytes = samplePdfBytes(sampleId);
  if (!bytes) throw new CaptureError("Unknown sample.");
  return capturePdf(orgKey, userId, { name: `${sampleSpec(sampleId)!.number}.pdf`, bytes }, { ...opts, sample: true });
}

// ─── Review ────────────────────────────────────────────────────────────────

export type CaptureView = Capture & {
  review: Review;
  /** Other drafts that look like the same invoice (D-63). */
  duplicates: { id: string; invoiceNumber: string; fileName: string; exact: boolean }[];
  hash: string;
};

const supplierOf = (c: Capture) => c.draft.vendorNo || c.draft.supplierTrn || c.issuerKey;

export function viewOf(c: Capture, all: Capture[], target: string | undefined): CaptureView {
  const review = reviewDraft(c.draft, { erp: Boolean(target) });
  const duplicates = all
    .filter((o) => o.id !== c.id && supplierOf(o) === supplierOf(c))
    .flatMap((o) => {
      const exact = Boolean(c.draft.invoiceNumber) && normInvoiceNo(o.draft.invoiceNumber) === normInvoiceNo(c.draft.invoiceNumber);
      const lookalike = !exact && o.draft.invoiceDate === c.draft.invoiceDate && o.draft.total !== null && o.draft.total === c.draft.total;
      return exact || lookalike ? [{ id: o.id, invoiceNumber: o.draft.invoiceNumber, fileName: o.fileName, exact }] : [];
    });
  const pushedTwin = duplicates.find((d) => d.exact && all.find((o) => o.id === d.id)?.status === "pushed");
  if (pushedTwin && c.status !== "pushed") review.blockers.unshift(`Invoice ${c.draft.invoiceNumber} from this supplier was already pushed from ${pushedTwin.fileName}.`);
  for (const d of duplicates) {
    if (d.exact && d.id !== pushedTwin?.id) review.warnings.unshift(`Same supplier and invoice number as ${d.fileName}. Check it isn't the same invoice twice.`);
    if (!d.exact) review.warnings.unshift(`Possible duplicate: ${d.fileName} (${d.invoiceNumber}) has the same supplier, date and total.`);
  }
  return { ...c, review, duplicates, hash: draftHash(c.draft, target ?? "") };
}

export async function listViews(orgKey: string): Promise<CaptureView[]> {
  const all = await store.listCaptures(orgKey);
  const target = (await currentTarget(orgKey))?.connectionId;
  return all.map((c) => viewOf(c, all, target));
}

export async function getView(orgKey: string, id: string): Promise<CaptureView | undefined> {
  const all = await store.listCaptures(orgKey);
  const c = all.find((x) => x.id === id);
  return c && viewOf(c, all, (await currentTarget(orgKey))?.connectionId);
}

/** Invoices of this vendor with this number already in the ERP, posted or not (D-63). */
export async function erpDuplicates(orgKey: string, d: Draft, deps?: ConnectorDeps) {
  const target = await currentTarget(orgKey);
  if (!target || !d.vendorNo || !d.invoiceNumber) return [];
  const { w, credentials, deps: use } = await writer(orgKey, target.connectionId, deps ?? liveDeps);
  return w.findExisting(credentials, d.vendorNo, d.invoiceNumber, use);
}

/** Saves the user's edits; an approval is withdrawn (D-66). */
export async function saveEdits(orgKey: string, id: string, draft: Draft): Promise<CaptureView> {
  const target = await currentTarget(orgKey);
  const c = await store.getCapture(orgKey, id);
  if (!c) throw new CaptureError("That invoice no longer exists.");
  if (c.status === "pushed" || c.status === "pushing") throw new CaptureError("This invoice was sent to the ERP and can't be changed here.");
  if (!(await store.saveDraft(orgKey, id, draft, statusFor(draft, Boolean(target))))) throw new CaptureError("This invoice can't be changed now.");
  return (await getView(orgKey, id))!;
}

/** Re-runs matching against fresh master data, for drafts not approved or pushed yet. */
export async function rematch(orgKey: string, deps?: ConnectorDeps): Promise<number> {
  const target = await currentTarget(orgKey);
  if (!target) return 0;
  const md = await masterData(orgKey, target.connectionId, { refresh: true, deps });
  let changed = 0;
  for (const c of await store.listCaptures(orgKey)) {
    if (c.status !== "needs_review" && c.status !== "ready") continue;
    const next = applyMatches(c.draft, md, await store.getProfile(orgKey, c.issuerKey, c.draft.supplierTrn), addDays);
    const status = statusFor(next, true);
    if (JSON.stringify(next) !== JSON.stringify(c.draft) || status !== c.status) {
      await store.saveDraft(orgKey, c.id, next, status);
      changed++;
    }
  }
  return changed;
}

// ─── Approve (D-66) ────────────────────────────────────────────────────────

export type BulkResult = { id: string; ok: boolean; message?: string };

/** Approves each draft that has nothing blocking it; the approval is for its exact content and target. */
export async function approveMany(orgKey: string, ids: string[], userId: string): Promise<BulkResult[]> {
  const views = await listViews(orgKey);
  const out: BulkResult[] = [];
  for (const id of [...new Set(ids)].slice(0, 200)) {
    const v = views.find((x) => x.id === id);
    if (!v) out.push({ id, ok: false, message: "Not found." });
    else if (v.status === "approved") out.push({ id, ok: true });
    else if (v.status !== "ready" && v.status !== "needs_review") out.push({ id, ok: false, message: `${v.draft.invoiceNumber || v.fileName} was already sent.` });
    else if (v.review.blockers.length) out.push({ id, ok: false, message: `${v.draft.invoiceNumber || v.fileName}: ${v.review.blockers[0]}` });
    else {
      if (v.status !== "ready") await store.setStatus(orgKey, id, "ready");
      out.push({ id, ok: await store.approve(orgKey, id, v.hash, userId) });
    }
  }
  return out;
}

export async function unapprove(orgKey: string, id: string) {
  await store.unapprove(orgKey, id);
}

// ─── Push (D-64) ───────────────────────────────────────────────────────────

/**
 * Pushes approved drafts the user confirmed, one by one. Each must still match the hash the
 * confirmation showed and its approval; it is checked against the ERP for duplicates first.
 */
export async function pushMany(orgKey: string, items: { id: string; hash: string }[], userId: string, deps?: ConnectorDeps): Promise<BulkResult[]> {
  const target = await currentTarget(orgKey);
  if (!target) throw new CaptureError("Choose the Business Central connection to push to.");
  const { w, credentials, deps: use } = await writer(orgKey, target.connectionId, deps ?? liveDeps);
  const out: BulkResult[] = [];
  for (const { id, hash } of items.slice(0, 50)) {
    const v = await getView(orgKey, id);
    const name = v?.draft.invoiceNumber || v?.fileName || id;
    if (!v) {
      out.push({ id, ok: false, message: "Not found." });
      continue;
    }
    if (v.status !== "approved" || v.approvedHash !== v.hash) {
      out.push({ id, ok: false, message: `${name} isn't approved as it stands. Approve it again.` });
      continue;
    }
    if (hash !== v.hash) {
      out.push({ id, ok: false, message: `${name} changed after you confirmed. Nothing was sent; check it and push again.` });
      continue;
    }
    if (v.review.blockers.length) {
      out.push({ id, ok: false, message: `${name}: ${v.review.blockers[0]}` });
      continue;
    }
    if (!(await store.claimForPush(orgKey, id))) {
      out.push({ id, ok: false, message: `${name} is already being sent.` });
      continue;
    }
    try {
      const d = v.draft;
      const existing = await w.findExisting(credentials, d.vendorNo, d.invoiceNumber, use);
      if (existing.length) {
        await store.releasePush(orgKey, id);
        out.push({ id, ok: false, message: `${name} is already in Business Central as ${existing.map((e) => `${e.number} (${e.status})`).join(", ")}. Nothing was sent.` });
        continue;
      }
      const created = await w.createDraft(
        credentials,
        {
          vendorNumber: d.vendorNo,
          vendorInvoiceNumber: d.invoiceNumber,
          invoiceDate: d.invoiceDate,
          dueDate: d.dueDate,
          currency: d.currency,
          lines: d.lines.map((l) => ({ type: l.erpType!, number: l.erpNo, description: l.description, quantity: l.qty!, directUnitCost: l.unitPrice! })),
        },
        use,
      );
      await store.markPushed(orgKey, id, {
        connectionId: target.connectionId,
        company: created.company,
        id: created.id,
        number: created.number,
        erpTotal: created.totalIncludingTax,
        pushedBy: userId,
        pushedAt: new Date().toISOString(),
      });
      await learn(orgKey, v);
      const off = created.totalIncludingTax !== null && d.total !== null && Math.abs(created.totalIncludingTax - d.total) > 0.01;
      out.push({
        id,
        ok: true,
        message: off
          ? `${name} is draft ${created.number}, but Business Central's total is ${created.totalIncludingTax} against ${d.total} on the invoice. Check the VAT setup on the draft in Business Central.`
          : `${name} is draft ${created.number} in ${created.company}.`,
      });
    } catch (error) {
      await store.releasePush(orgKey, id);
      out.push({ id, ok: false, message: `${name}: ${error instanceof ConnectorError ? error.message : "Business Central didn't answer. Nothing was sent; try again."}` });
      if (!(error instanceof ConnectorError)) console.error("purchase invoice push failed", error);
    }
  }
  return out;
}

/** Reviewed choices become supplier memory (D-61). */
async function learn(orgKey: string, c: Capture) {
  const prev = await store.getProfile(orgKey, c.issuerKey, c.draft.supplierTrn);
  await store.saveProfile(orgKey, learnFromDraft(prev, c.issuerKey, c.draft, daysBetween));
}

/** Drafts for a CSV (D-65). Exporting approved drafts teaches the supplier memory too. */
export async function draftsForExport(orgKey: string, ids: string[] | "approved"): Promise<Capture[]> {
  const all = await store.listCaptures(orgKey);
  const picked = ids === "approved" ? all.filter((c) => c.status === "approved") : all.filter((c) => ids.includes(c.id));
  for (const c of picked) if (c.status === "approved" || c.status === "pushed") await learn(orgKey, c);
  return picked.reverse();
}

export async function discard(orgKey: string, id: string): Promise<boolean> {
  const c = await store.deleteCapture(orgKey, id);
  if (c?.storedPath) await deleteFiles([c.storedPath]).catch(() => undefined);
  return Boolean(c);
}
