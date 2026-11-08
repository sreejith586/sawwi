import { createHash } from "node:crypto";
import { connectorById } from "@/lib/connectors/registry";
import { demoConnectionId } from "@/lib/connectors/mock";
import { liveDeps, openConnection } from "@/lib/connectors/service";
import { listConnections } from "@/lib/connectors/store";
import { ConnectorError, type ConnectorDeps, type ErpInvoiceRef } from "@/lib/connectors/types";
import { isDemoOrg } from "@/lib/demo/demo";
import { parseUploads, UnsupportedFileError } from "@/lib/files/parse";
import { matchParcels, type OtherBatches } from "./match";
import { parseRemittances, RemittanceParseError } from "./parse";
import { applyEdits, documentNumber, draftFromParsed, parcelKey, remittanceCsv, reviewRemittance, type CodSettings, type RemittanceDraft, type RemittanceReview } from "./remittance";
import { codSample } from "./samples";
import * as store from "./store";
import type { CodErpData, CodStatus, Remittance } from "./store";

// COD remittances → customer payments applied to invoices, plus the money-side journal (D-74–D-77).

export class CodError extends Error {}

const TTL_MS = 60 * 60_000;
export const MAX_REMITTANCE_BYTES = 25 * 1024 * 1024;
export const codIncomingFolder = (orgKey: string) => `incoming/cod/${createHash("sha256").update(orgKey).digest("hex").slice(0, 24)}/`;

export function remittanceHash(d: RemittanceDraft, s: CodSettings, target: string): string {
  const relevant = { d, accounts: s.accounts, customer: s.defaultCustomer, pj: s.paymentJournalId, gj: s.generalJournalId, target };
  return createHash("sha256").update(JSON.stringify(relevant)).digest("hex").slice(0, 32);
}

// ─── Target and ERP data ───────────────────────────────────────────────────

export type CodTarget = { connectionId: string; label: string };

/** Connections that take customer payments and journal lines. In the demo, the store company (D-77). */
export async function codTargets(orgKey: string): Promise<CodTarget[]> {
  if (isDemoOrg(orgKey)) return [{ connectionId: demoConnectionId("business-central-store"), label: "Business Central: Sawwi Demo Store LLC (Sandbox, mock)" }];
  return (await listConnections(orgKey)).flatMap((c) => {
    const connector = connectorById(c.provider);
    return connector?.customerPayments && connector.journals ? [{ connectionId: c.id, label: `${connector.label}: ${c.accountLabel}` }] : [];
  });
}

export async function currentCodTarget(orgKey: string): Promise<CodTarget | undefined> {
  const targets = await codTargets(orgKey);
  const { target } = await store.getSettings(orgKey);
  if (target === "none") return undefined;
  return targets.find((t) => t.connectionId === target) ?? (targets.length === 1 ? targets[0] : undefined);
}

async function writers(orgKey: string, connectionId: string, deps: ConnectorDeps) {
  const c = await openConnection(orgKey, connectionId, deps);
  const pay = c.connector.customerPayments;
  const gl = c.connector.journals;
  if (!pay || !gl) throw new ConnectorError(`${c.connector.label} can't take customer payments.`);
  return { ...c, pay, gl };
}

export async function erpData(orgKey: string, connectionId: string, opts: { refresh?: boolean; deps?: ConnectorDeps } = {}): Promise<CodErpData> {
  const cached = await store.getErpCache(orgKey, connectionId);
  if (cached && !opts.refresh && Date.now() - Date.parse(cached.fetchedAt) < TTL_MS) return cached;
  const { pay, gl, credentials, deps } = await writers(orgKey, connectionId, opts.deps ?? liveDeps);
  const a = await gl.accounts(credentials, deps);
  const data: CodErpData = {
    ...a,
    customers: await pay.customers(credentials, deps),
    paymentJournals: await pay.listJournals(credentials, deps),
    generalJournals: await gl.listJournals(credentials, deps),
    fetchedAt: new Date().toISOString(),
  };
  await store.saveErpCache(orgKey, connectionId, data);
  return data;
}

async function erpDataOrCached(orgKey: string, connectionId: string | undefined, deps?: ConnectorDeps) {
  if (!connectionId) return undefined;
  try {
    return await erpData(orgKey, connectionId, { deps });
  } catch {
    return store.getErpCache(orgKey, connectionId);
  }
}

const pick = (list: { id: string; code: string }[], chosen: string | null, codes: RegExp) =>
  chosen && list.some((j) => j.id === chosen) ? chosen : (list.length === 1 ? list[0] : list.find((j) => codes.test(j.code)))?.id ?? null;

async function effectiveSettings(orgKey: string, deps?: ConnectorDeps) {
  const { settings } = await store.getSettings(orgKey);
  const target = await currentCodTarget(orgKey);
  const erp = await erpDataOrCached(orgKey, target?.connectionId, deps);
  const names = { ...settings.accountNames, ...Object.fromEntries((erp?.accounts ?? []).map((a) => [a.number, a.name])) };
  return {
    settings: {
      ...settings,
      accountNames: names,
      paymentJournalId: pick(erp?.paymentJournals ?? [], settings.paymentJournalId, /cod|rcpt|receipt|payment/i),
      generalJournalId: pick(erp?.generalJournals ?? [], settings.generalJournalId, /^(default|general)$/i),
    },
    target,
    erp,
  };
}

// ─── Review ────────────────────────────────────────────────────────────────

export type RemittanceView = Remittance & { review: RemittanceReview; hash: string };

function view(r: Remittance, s: CodSettings, target: CodTarget | undefined, erp: CodErpData | undefined): RemittanceView {
  const review = reviewRemittance(r.draft, s, { erp: Boolean(target) });
  if (target) {
    if (!s.paymentJournalId) review.blockers.push("Choose the Business Central customer payment batch.");
    if (!s.generalJournalId) review.blockers.push("Choose the Business Central general journal batch for fees.");
    if (erp?.lcy && r.draft.currency && r.draft.currency !== erp.lcy) review.blockers.push(`This remittance is in ${r.draft.currency}, not ${erp.lcy}: download it as CSV instead.`);
  }
  return { ...r, review, hash: remittanceHash(r.draft, s, target?.connectionId ?? "") };
}

const statusFor = (v: Pick<RemittanceView, "review">): CodStatus => (v.review.blockers.length ? "needs_review" : "ready");

export async function listViews(orgKey: string, deps?: ConnectorDeps) {
  const { settings, target, erp } = await effectiveSettings(orgKey, deps);
  const all = await store.listRemittances(orgKey);
  return { views: all.map((r) => view(r, settings, target, erp)), settings, target, erp };
}

export async function getView(orgKey: string, id: string, deps?: ConnectorDeps) {
  const all = await listViews(orgKey, deps);
  const v = all.views.find((x) => x.id === id);
  return v && { ...all, view: v };
}

async function refreshStatuses(orgKey: string) {
  const { views } = await listViews(orgKey);
  for (const v of views) {
    if (v.status === "pushed" || v.status === "pushing") continue;
    if (v.status === "approved" && v.approvedHash === v.hash && v.review.blockers.length === 0) continue;
    const next = statusFor(v);
    if (next !== v.status) await store.setStatus(orgKey, v.id, next, v.status === "approved");
  }
}

// ─── Matching ──────────────────────────────────────────────────────────────

const norm = (s: string) => s.trim().toUpperCase();

/** AWBs and applied invoices in the workspace's other batches (D-74). */
function othersOf(all: Remittance[], exceptId: string | null): OtherBatches {
  const awbs = new Map<string, string>();
  const invoices = new Map<string, string>();
  for (const r of all) {
    if (r.id === exceptId) continue;
    for (const p of r.draft.parcels) {
      if (p.action === "exclude") continue;
      if (p.awb) awbs.set(norm(p.awb), `${r.courier} ${r.batchId}`);
      if (p.action === "apply" && p.invoiceNumber) invoices.set(norm(p.invoiceNumber), `${r.courier} ${r.batchId}`);
    }
  }
  return { awbs, invoices };
}

/** Invoices for a batch: open ones once, the rest looked up one by one. Without an ERP, nothing is matched. */
async function invoicesFor(orgKey: string, target: CodTarget | undefined, refs: string[], deps?: ConnectorDeps): Promise<{ open: ErpInvoiceRef[]; looked: ErpInvoiceRef[] } | undefined> {
  if (!target) return undefined;
  const { pay, credentials, deps: use } = await writers(orgKey, target.connectionId, deps ?? liveDeps);
  const open = await pay.openInvoices(credentials, use);
  const known = new Set(open.flatMap((i) => [norm(i.externalDocumentNumber), norm(i.number), norm(i.orderNumber)]));
  const missing = refs.filter((r) => r && !known.has(norm(r)));
  return { open, looked: missing.length ? await pay.lookupInvoices(credentials, missing, use) : [] };
}

/** Matches a draft; decisions the user made are kept where the parcel's invoice didn't change. */
function rematchDraft(prev: RemittanceDraft, inv: { open: ErpInvoiceRef[]; looked: ErpInvoiceRef[] }, others: OtherBatches): RemittanceDraft {
  const next = matchParcels(prev, inv.open, inv.looked, others);
  return {
    ...next,
    parcels: next.parcels.map((p, i) => {
      const before = prev.parcels[i];
      const same = before && parcelKey(before) === parcelKey(p) && before.invoiceNumber === p.invoiceNumber && before.invoiceState === p.invoiceState && before.duplicateOf === p.duplicateOf;
      return same && before.action !== null ? { ...p, action: before.action } : p;
    }),
  };
}

export async function rematch(orgKey: string, deps?: ConnectorDeps): Promise<number> {
  const { target, settings, erp } = await effectiveSettings(orgKey, deps);
  if (!target) throw new CodError("Choose the Business Central connection first.");
  await erpData(orgKey, target.connectionId, { refresh: true, deps });
  const all = await store.listRemittances(orgKey);
  let changed = 0;
  for (const r of all) {
    if (r.status === "pushed" || r.status === "pushing") continue;
    const inv = (await invoicesFor(orgKey, target, r.draft.parcels.map((p) => p.orderRef), deps))!;
    const draft = rematchDraft(r.draft, inv, othersOf(all, r.id));
    if (JSON.stringify(draft) === JSON.stringify(r.draft)) continue;
    await store.saveDraft(orgKey, r.id, draft, statusFor(view({ ...r, draft }, settings, target, erp)));
    changed++;
  }
  await refreshStatuses(orgKey);
  return changed;
}

// ─── Capture ───────────────────────────────────────────────────────────────

export type CaptureResult = { batchId: string; courier: string; id: string; existing: boolean };

export async function captureFile(orgKey: string, userId: string | null, file: { name: string; bytes: Uint8Array }, deps?: ConnectorDeps): Promise<CaptureResult[]> {
  if (file.bytes.length > MAX_REMITTANCE_BYTES) throw new CodError(`${file.name} is over 25 MB.`);
  let parsed;
  try {
    parsed = parseRemittances(await parseUploads([{ name: file.name, data: file.bytes }]), file.name);
  } catch (error) {
    if (error instanceof RemittanceParseError) throw new CodError(`${file.name}: ${error.message}`);
    if (error instanceof UnsupportedFileError) throw new CodError(error.message);
    throw error;
  }
  const { settings, target, erp } = await effectiveSettings(orgKey, deps);
  const out: CaptureResult[] = [];
  for (const p of parsed) {
    const seen = await store.findRemittance(orgKey, p.courier, p.batchId);
    if (seen) {
      out.push({ batchId: p.batchId, courier: p.courier, id: seen.id, existing: true });
      continue;
    }
    let draft = draftFromParsed(p);
    // A report with no currency column is in the company's own currency.
    if (!draft.currency && erp?.lcy) draft = { ...draft, currency: erp.lcy };
    const all = await store.listRemittances(orgKey);
    const inv = await invoicesFor(orgKey, target, draft.parcels.map((x) => x.orderRef), deps).catch(() => undefined);
    const others = othersOf(all, null);
    draft = inv ? matchParcels(draft, inv.open, inv.looked, others) : { ...draft, parcels: draft.parcels.map((x) => {
      const dup = x.awb ? others.awbs.get(norm(x.awb)) : undefined;
      return dup ? { ...x, duplicateOf: dup, action: null } : x;
    }) };
    const status = statusFor(view({ draft, status: "needs_review" } as Remittance, settings, target, erp));
    const r = await store.insertRemittance({ orgKey, fileName: file.name, status, draft, createdBy: userId });
    const id = r?.id ?? (await store.findRemittance(orgKey, p.courier, p.batchId))!.id;
    out.push({ batchId: p.batchId, courier: p.courier, id, existing: !r });
  }
  return out;
}

export async function captureSample(orgKey: string, userId: string | null, sampleId: string, deps?: ConnectorDeps) {
  const s = codSample(sampleId);
  if (!s) throw new CodError("Unknown sample.");
  return captureFile(orgKey, userId, { name: s.fileName, bytes: new TextEncoder().encode(s.text()) }, deps);
}

// ─── Edits and settings ────────────────────────────────────────────────────

export async function saveEdits(orgKey: string, id: string, input: unknown) {
  const r = await store.getRemittance(orgKey, id);
  if (!r) throw new CodError("That remittance no longer exists.");
  if (r.status === "pushed" || r.status === "pushing") throw new CodError("This remittance was sent to the ERP and can't be changed here.");
  const draft = applyEdits(r.draft, input);
  if (!draft) throw new CodError("Those changes couldn't be read.");
  const { settings, target, erp } = await effectiveSettings(orgKey);
  await store.saveDraft(orgKey, id, draft, statusFor(view({ ...r, draft }, settings, target, erp)));
  return (await getView(orgKey, id))!.view;
}

export type CodSettingsInput = { accounts?: Record<string, unknown>; defaultCustomer?: unknown; paymentJournalId?: unknown; generalJournalId?: unknown; target?: unknown };

export async function updateSettings(orgKey: string, input: CodSettingsInput) {
  const { settings, target } = await store.getSettings(orgKey);
  const next: CodSettings = { ...settings, accounts: { ...settings.accounts } };
  for (const k of ["bank", "clearing", "fees", "feeVat"] as const) {
    if (!input.accounts || !(k in input.accounts)) continue;
    const v = input.accounts[k];
    const acct = typeof v === "string" ? v.trim().slice(0, 20) : "";
    if (acct) next.accounts[k] = acct;
    else delete next.accounts[k];
  }
  if (input.defaultCustomer !== undefined) next.defaultCustomer = typeof input.defaultCustomer === "string" ? input.defaultCustomer.trim().slice(0, 20) : "";
  if (input.paymentJournalId !== undefined) next.paymentJournalId = typeof input.paymentJournalId === "string" && input.paymentJournalId ? input.paymentJournalId : null;
  if (input.generalJournalId !== undefined) next.generalJournalId = typeof input.generalJournalId === "string" && input.generalJournalId ? input.generalJournalId : null;
  let nextTarget = target;
  if (input.target !== undefined) {
    const t = typeof input.target === "string" && input.target ? input.target : "none";
    if (t !== "none" && !(await codTargets(orgKey)).some((x) => x.connectionId === t)) throw new CodError("That connection can't take customer payments.");
    nextTarget = t;
  }
  await store.saveSettings(orgKey, next, nextTarget);
  await refreshStatuses(orgKey);
}

// ─── Approve, push, export ─────────────────────────────────────────────────

export type BulkResult = { id: string; ok: boolean; message?: string };
const nameOf = (r: Remittance) => `${r.courier} ${r.batchId}`;

export async function approveMany(orgKey: string, ids: string[], userId: string): Promise<BulkResult[]> {
  const { views } = await listViews(orgKey);
  const out: BulkResult[] = [];
  for (const id of [...new Set(ids)].slice(0, 200)) {
    const v = views.find((x) => x.id === id);
    if (!v) out.push({ id, ok: false, message: "Not found." });
    else if (v.status === "approved" && v.approvedHash === v.hash) out.push({ id, ok: true });
    else if (v.status === "pushed" || v.status === "pushing") out.push({ id, ok: false, message: `${nameOf(v)} was already sent.` });
    else if (v.review.blockers.length) out.push({ id, ok: false, message: `${nameOf(v)}: ${v.review.blockers[0]}` });
    else {
      if (v.status !== "ready") await store.setStatus(orgKey, id, "ready", true);
      out.push({ id, ok: await store.approve(orgKey, id, v.hash, userId) });
    }
  }
  return out;
}

export const unapprove = (orgKey: string, id: string) => store.unapprove(orgKey, id);

/** Customer payments first, then the money-side journal; if the journal fails, the payments are removed (D-75). */
export async function pushMany(orgKey: string, items: { id: string; hash: string }[], userId: string, deps?: ConnectorDeps): Promise<BulkResult[]> {
  const target = await currentCodTarget(orgKey);
  if (!target) throw new CodError("Choose the Business Central connection to push to.");
  const { pay, gl, credentials, deps: use } = await writers(orgKey, target.connectionId, deps ?? liveDeps);
  const out: BulkResult[] = [];
  for (const { id, hash } of items.slice(0, 50)) {
    const found = await getView(orgKey, id, deps);
    if (!found) {
      out.push({ id, ok: false, message: "Not found." });
      continue;
    }
    const { view: v, settings } = found;
    const name = nameOf(v);
    if (v.status !== "approved" || v.approvedHash !== v.hash) {
      out.push({ id, ok: false, message: `${name} isn't approved as it stands. Approve it again.` });
      continue;
    }
    if (hash !== v.hash) {
      out.push({ id, ok: false, message: `${name} changed after you confirmed. Nothing was sent.` });
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
    const doc = documentNumber(v.draft);
    let paymentIds: string[] = [];
    try {
      const existing = [
        ...(await pay.findDocument(credentials, settings.paymentJournalId!, doc, use)),
        ...(await gl.findDocument(credentials, settings.generalJournalId!, doc, use)).filter((e) => e.where === "unposted"),
      ];
      if (existing.length) {
        await store.releasePush(orgKey, id);
        out.push({ id, ok: false, message: `${name} is already in Business Central (${[...new Set(existing.map((e) => e.detail))].join("; ")}). Nothing was sent.` });
        continue;
      }
      const p = await pay.createPayments(
        credentials,
        settings.paymentJournalId!,
        v.review.payments.map((x) => ({ customerNumber: x.customerNumber, appliesToInvoiceNumber: x.invoiceNumber, postingDate: v.draft.postingDate, documentNumber: doc, externalDocumentNumber: x.awb || x.orderRef, amount: x.amount, description: x.description })),
        use,
      );
      paymentIds = p.ids;
      const g = await gl.createLines(
        credentials,
        settings.generalJournalId!,
        v.review.gl.map((l) => ({ accountNumber: l.account, postingDate: v.draft.postingDate, documentNumber: doc, externalDocumentNumber: v.draft.courier, amount: l.amount, description: l.description })),
        use,
      );
      await store.markPushed(orgKey, id, { connectionId: target.connectionId, company: p.company, paymentJournal: p.journal, generalJournal: g.journal, payments: p.ids.length, glLines: g.count, pushedBy: userId, pushedAt: new Date().toISOString() });
      out.push({ id, ok: true, message: `${name}: ${p.ids.length} customer payments in batch ${p.journal} and ${g.count} journal lines in ${g.journal}, unposted, in ${p.company}.` });
    } catch (error) {
      if (paymentIds.length) await pay.deletePayments(credentials, settings.paymentJournalId!, paymentIds, use).catch(() => undefined);
      await store.releasePush(orgKey, id);
      out.push({ id, ok: false, message: `${name}: ${error instanceof ConnectorError ? error.message : "Business Central didn't answer. Nothing was sent; try again."}` });
      if (!(error instanceof ConnectorError)) console.error("COD remittance push failed", error);
    }
  }
  return out;
}

export async function exportCsv(orgKey: string, ids: string[] | "approved") {
  const { views } = await listViews(orgKey);
  const picked = ids === "approved" ? views.filter((v) => v.status === "approved") : views.filter((v) => ids.includes(v.id));
  const csv = remittanceCsv(picked.reverse().map((v) => ({ draft: v.draft, review: v.review })));
  const name = picked.length === 1 ? `cod-${picked[0].courier}-${picked[0].batchId}.csv`.replace(/[^\w.-]+/g, "_") : `cod-remittances-${new Date().toISOString().slice(0, 10)}.csv`;
  return { csv, count: picked.length, name };
}

export const discard = (orgKey: string, id: string) => store.deleteRemittance(orgKey, id);
