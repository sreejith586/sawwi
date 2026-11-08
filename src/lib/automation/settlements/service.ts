import { createHash } from "node:crypto";
import { connectorById } from "@/lib/connectors/registry";
import { demoConnectionId } from "@/lib/connectors/mock";
import { liveDeps, openConnection } from "@/lib/connectors/service";
import { listConnections } from "@/lib/connectors/store";
import { ConnectorError, type ConnectorDeps } from "@/lib/connectors/types";
import { isDemoOrg } from "@/lib/demo/demo";
import { parseUploads, UnsupportedFileError } from "@/lib/files/parse";
import { BUCKETS, type Bucket } from "./buckets";
import { applyEdits, buildJournal, documentNumber, draftFromParsed, journalCsv, type JournalReview, type SettlementDraft, type SettlementSettings } from "./journal";
import { parseSettlements, SettlementParseError } from "./parse";
import { settlementSample } from "./samples";
import * as store from "./store";
import type { ErpJournalData, JournalStatus, SettlementJournal } from "./store";

// Marketplace settlements → journal entries (D-70–D-73). Same shape as purchase invoice capture:
// file in → drafts → review → approve → CSV or unposted lines in the ERP.

export class SettlementError extends Error {}

const TTL_MS = 60 * 60_000;
export const MAX_SETTLEMENT_BYTES = 25 * 1024 * 1024;

/** Where the browser puts this workspace's settlement uploads in the Blob store (D-39). */
export const settlementIncomingFolder = (orgKey: string) => `incoming/settlements/${createHash("sha256").update(orgKey).digest("hex").slice(0, 24)}/`;

export function journalHash(d: SettlementDraft, settings: SettlementSettings, target: string): string {
  // The approval covers the draft and everything that decides its lines: accounts, VAT split, batch and target.
  const relevant = { d, accounts: settings.accounts, vat: settings.salesVatRate, journal: settings.journalId, target };
  return createHash("sha256").update(JSON.stringify(relevant)).digest("hex").slice(0, 32);
}

// ─── Target and ERP data ───────────────────────────────────────────────────

export type JournalTarget = { connectionId: string; label: string };

/** Connections that can take journal lines. In the demo, the store company's books (D-73). */
export async function journalTargets(orgKey: string): Promise<JournalTarget[]> {
  if (isDemoOrg(orgKey)) return [{ connectionId: demoConnectionId("business-central-store"), label: "Business Central: Sawwi Demo Store LLC (Sandbox, mock)" }];
  return (await listConnections(orgKey)).flatMap((c) => {
    const connector = connectorById(c.provider);
    return connector?.journals ? [{ connectionId: c.id, label: `${connector.label}: ${c.accountLabel}` }] : [];
  });
}

export async function currentJournalTarget(orgKey: string): Promise<JournalTarget | undefined> {
  const targets = await journalTargets(orgKey);
  const { target } = await store.getSettings(orgKey);
  if (target === "none") return undefined;
  return targets.find((t) => t.connectionId === target) ?? (targets.length === 1 ? targets[0] : undefined);
}

async function writer(orgKey: string, connectionId: string, deps: ConnectorDeps) {
  const c = await openConnection(orgKey, connectionId, deps);
  const w = c.connector.journals;
  if (!w) throw new ConnectorError(`${c.connector.label} can't take journal lines.`);
  return { ...c, w };
}

/** Accounts and journal batches from the ERP, cached for an hour. */
export async function erpData(orgKey: string, connectionId: string, opts: { refresh?: boolean; deps?: ConnectorDeps } = {}): Promise<ErpJournalData> {
  const cached = await store.getErpCache(orgKey, connectionId);
  if (cached && !opts.refresh && Date.now() - Date.parse(cached.fetchedAt) < TTL_MS) return cached;
  const { w, credentials, deps } = await writer(orgKey, connectionId, opts.deps ?? liveDeps);
  const a = await w.accounts(credentials, deps);
  const data: ErpJournalData = { ...a, journals: await w.listJournals(credentials, deps), fetchedAt: new Date().toISOString() };
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

/** The settings with account names from the ERP, and the batch defaulted to the only one (or "DEFAULT"/"GENERAL"). */
async function effectiveSettings(orgKey: string, deps?: ConnectorDeps) {
  const { settings } = await store.getSettings(orgKey);
  const target = await currentJournalTarget(orgKey);
  const erp = await erpDataOrCached(orgKey, target?.connectionId, deps);
  const names = { ...settings.accountNames, ...Object.fromEntries((erp?.accounts ?? []).map((a) => [a.number, a.name])) };
  const journals = erp?.journals ?? [];
  const journalId =
    settings.journalId && journals.some((j) => j.id === settings.journalId)
      ? settings.journalId
      : (journals.length === 1 ? journals[0] : journals.find((j) => /^(default|general)$/i.test(j.code)))?.id ?? null;
  return { settings: { ...settings, accountNames: names, journalId }, target, erp };
}

// ─── Review ────────────────────────────────────────────────────────────────

export type JournalView = SettlementJournal & { journal: JournalReview; hash: string };

/** The journal and what blocks it. With a target, a push also needs a batch and the company's own currency. */
function review(j: SettlementJournal, settings: SettlementSettings, target: JournalTarget | undefined, erp: ErpJournalData | undefined, all: SettlementJournal[]): JournalView {
  const journal = buildJournal(j.draft, settings);
  if (target) {
    if (!settings.journalId) journal.blockers.push("Choose the Business Central journal batch.");
    if (erp?.lcy && j.draft.currency && j.draft.currency !== erp.lcy) {
      journal.blockers.push(`This settlement is in ${j.draft.currency}, not ${erp.lcy}: Business Central journal lines through the API carry no currency, so download it as CSV instead (D-71).`);
    }
  }
  const twin = all.find((o) => o.id !== j.id && o.status === "pushed" && documentNumber(o.draft) === documentNumber(j.draft));
  if (twin && j.status !== "pushed") journal.blockers.unshift(`Document number ${documentNumber(j.draft)} was already pushed from ${twin.marketplace} settlement ${twin.settlementId}.`);
  return { ...j, journal, hash: journalHash(j.draft, settings, target?.connectionId ?? "") };
}

const statusFor = (v: Pick<JournalView, "journal">): JournalStatus => (v.journal.blockers.length ? "needs_review" : "ready");

export async function listViews(orgKey: string, deps?: ConnectorDeps) {
  const { settings, target, erp } = await effectiveSettings(orgKey, deps);
  const all = await store.listJournals(orgKey);
  return { views: all.map((j) => review(j, settings, target, erp, all)), settings, target, erp };
}

export async function getView(orgKey: string, id: string, deps?: ConnectorDeps) {
  const { views, settings, target, erp } = await listViews(orgKey, deps);
  const view = views.find((v) => v.id === id);
  return view && { view, settings, target, erp };
}

/** After settings change, statuses follow; an approval stays only while its hash still holds. */
async function refreshStatuses(orgKey: string) {
  const { views } = await listViews(orgKey);
  for (const v of views) {
    if (v.status === "pushed" || v.status === "pushing") continue;
    if (v.status === "approved" && v.approvedHash === v.hash && v.journal.blockers.length === 0) continue;
    const next = statusFor(v);
    if (next !== v.status) await store.setStatus(orgKey, v.id, next, v.status === "approved");
  }
}

// ─── Capture ───────────────────────────────────────────────────────────────

export type CaptureResult = { settlementId: string; marketplace: string; id: string; existing: boolean };

export async function captureFile(orgKey: string, userId: string | null, file: { name: string; bytes: Uint8Array }): Promise<CaptureResult[]> {
  if (file.bytes.length > MAX_SETTLEMENT_BYTES) throw new SettlementError(`${file.name} is over 25 MB.`);
  let parsed;
  try {
    const table = await parseUploads([{ name: file.name, data: file.bytes }]);
    parsed = parseSettlements(table, file.name);
  } catch (error) {
    if (error instanceof SettlementParseError) throw new SettlementError(`${file.name}: ${error.message}`);
    if (error instanceof UnsupportedFileError) throw new SettlementError(error.message);
    throw error;
  }
  const { settings, target, erp } = await effectiveSettings(orgKey);
  const out: CaptureResult[] = [];
  for (const p of parsed) {
    const seen = await store.findJournal(orgKey, p.marketplace, p.settlementId);
    if (seen) {
      out.push({ settlementId: p.settlementId, marketplace: p.marketplace, id: seen.id, existing: true });
      continue;
    }
    const draft = draftFromParsed(p, settings);
    const fake = { draft, status: "needs_review" } as SettlementJournal;
    const status = statusFor(review(fake, settings, target, erp, []));
    const j = await store.insertJournal({ orgKey, fileName: file.name, status, draft, createdBy: userId });
    // A concurrent upload of the same settlement: show the one that won.
    const id = j?.id ?? (await store.findJournal(orgKey, p.marketplace, p.settlementId))!.id;
    out.push({ settlementId: p.settlementId, marketplace: p.marketplace, id, existing: !j });
  }
  return out;
}

export async function captureSample(orgKey: string, userId: string | null, sampleId: string) {
  const s = settlementSample(sampleId);
  if (!s) throw new SettlementError("Unknown sample.");
  return captureFile(orgKey, userId, { name: s.fileName, bytes: new TextEncoder().encode(s.text()) });
}

// ─── Edits and settings ────────────────────────────────────────────────────

/**
 * Saves the user's classifications and posting date. A category classified by hand is remembered
 * for the marketplace and applied to its other settlements still waiting for one.
 */
export async function saveEdits(orgKey: string, id: string, input: unknown) {
  const j = await store.getJournal(orgKey, id);
  if (!j) throw new SettlementError("That settlement no longer exists.");
  if (j.status === "pushed" || j.status === "pushing") throw new SettlementError("This journal was sent to the ERP and can't be changed here.");
  const draft = applyEdits(j.draft, input);
  if (!draft) throw new SettlementError("Those changes couldn't be read.");
  const { settings: stored, target } = await store.getSettings(orgKey);
  const learned = { ...(stored.categories[draft.marketplace] ?? {}) };
  for (const c of draft.categories) if (c.classifiedBy === "user" && c.bucket) learned[c.key] = c.bucket;
  await store.saveSettings(orgKey, { ...stored, categories: { ...stored.categories, [draft.marketplace]: learned } }, target);
  const { settings, target: t, erp } = await effectiveSettings(orgKey);
  await store.saveDraft(orgKey, id, draft, statusFor(review({ ...j, draft }, settings, t, erp, [])));
  // Same marketplace, still unclassified: use what was just learned.
  for (const other of await store.listJournals(orgKey)) {
    if (other.id === id || other.marketplace !== draft.marketplace || other.status === "pushed" || other.status === "pushing") continue;
    let changed = false;
    const categories = other.draft.categories.map((c) => {
      if (c.bucket || !learned[c.key]) return c;
      changed = true;
      return { ...c, bucket: learned[c.key], classifiedBy: "memory" as const };
    });
    if (changed) await store.saveDraft(orgKey, other.id, { ...other.draft, categories }, statusFor(review({ ...other, draft: { ...other.draft, categories } }, settings, t, erp, [])));
  }
  return (await getView(orgKey, id))!.view;
}

export type SettingsInput = { accounts?: Record<string, unknown>; salesVatRate?: unknown; journalId?: unknown; target?: unknown };

export async function updateSettings(orgKey: string, input: SettingsInput) {
  const { settings, target } = await store.getSettings(orgKey);
  const next: SettlementSettings = { ...settings, accounts: { ...settings.accounts } };
  const keys = new Set<string>([...BUCKETS.map((b) => b.id), "payout"]);
  for (const [k, v] of Object.entries(input.accounts ?? {})) {
    if (!keys.has(k)) continue;
    const acct = typeof v === "string" ? v.trim().slice(0, 20) : "";
    if (acct) next.accounts[k as Bucket | "payout"] = acct;
    else delete next.accounts[k as Bucket | "payout"];
  }
  if (input.salesVatRate !== undefined) {
    const rate = Number(input.salesVatRate);
    next.salesVatRate = input.salesVatRate === null || input.salesVatRate === "" || !Number.isFinite(rate) || rate <= 0 || rate > 30 ? null : rate;
  }
  if (input.journalId !== undefined) next.journalId = typeof input.journalId === "string" && input.journalId ? input.journalId : null;
  let nextTarget = target;
  if (input.target !== undefined) {
    const t = typeof input.target === "string" && input.target ? input.target : "none";
    if (t !== "none" && !(await journalTargets(orgKey)).some((x) => x.connectionId === t)) throw new SettlementError("That connection can't take journal lines.");
    nextTarget = t;
  }
  await store.saveSettings(orgKey, next, nextTarget);
  await refreshStatuses(orgKey);
}

export async function refreshErp(orgKey: string, deps?: ConnectorDeps) {
  const target = await currentJournalTarget(orgKey);
  if (!target) throw new SettlementError("Choose the Business Central connection first.");
  await erpData(orgKey, target.connectionId, { refresh: true, deps });
  await refreshStatuses(orgKey);
}

// ─── Approve, push, export ─────────────────────────────────────────────────

export type BulkResult = { id: string; ok: boolean; message?: string };
const nameOf = (j: SettlementJournal) => `${j.marketplace} ${j.settlementId}`;

export async function approveMany(orgKey: string, ids: string[], userId: string): Promise<BulkResult[]> {
  const { views } = await listViews(orgKey);
  const out: BulkResult[] = [];
  for (const id of [...new Set(ids)].slice(0, 200)) {
    const v = views.find((x) => x.id === id);
    if (!v) out.push({ id, ok: false, message: "Not found." });
    else if (v.status === "approved" && v.approvedHash === v.hash) out.push({ id, ok: true });
    else if (v.status === "pushed" || v.status === "pushing") out.push({ id, ok: false, message: `${nameOf(v)} was already sent.` });
    else if (v.journal.blockers.length) out.push({ id, ok: false, message: `${nameOf(v)}: ${v.journal.blockers[0]}` });
    else {
      if (v.status !== "ready") await store.setStatus(orgKey, id, "ready", true);
      out.push({ id, ok: await store.approve(orgKey, id, v.hash, userId) });
    }
  }
  return out;
}

export const unapprove = (orgKey: string, id: string) => store.unapprove(orgKey, id);

/** Pushes approved journals the user confirmed, each against its hash and checked against the ERP first (D-71, D-72). */
export async function pushMany(orgKey: string, items: { id: string; hash: string }[], userId: string, deps?: ConnectorDeps): Promise<BulkResult[]> {
  const target = await currentJournalTarget(orgKey);
  if (!target) throw new SettlementError("Choose the Business Central connection to push to.");
  const { w, credentials, deps: use } = await writer(orgKey, target.connectionId, deps ?? liveDeps);
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
    if (v.journal.blockers.length) {
      out.push({ id, ok: false, message: `${name}: ${v.journal.blockers[0]}` });
      continue;
    }
    if (!(await store.claimForPush(orgKey, id))) {
      out.push({ id, ok: false, message: `${name} is already being sent.` });
      continue;
    }
    try {
      const doc = documentNumber(v.draft);
      const existing = await w.findDocument(credentials, settings.journalId!, doc, use);
      if (existing.length) {
        await store.releasePush(orgKey, id);
        out.push({ id, ok: false, message: `${name} is already in Business Central (${existing.map((e) => e.detail).join("; ")}). Nothing was sent.` });
        continue;
      }
      const res = await w.createLines(
        credentials,
        settings.journalId!,
        v.journal.lines.map((l) => ({ accountNumber: l.account, postingDate: v.draft.postingDate, documentNumber: doc, externalDocumentNumber: v.draft.marketplace, amount: l.amount, description: l.description })),
        use,
      );
      await store.markPushed(orgKey, id, { connectionId: target.connectionId, company: res.company, journal: res.journal, lines: res.count, pushedBy: userId, pushedAt: new Date().toISOString() });
      out.push({ id, ok: true, message: `${name}: ${res.count} unposted lines in ${res.company}, batch ${res.journal}.` });
    } catch (error) {
      await store.releasePush(orgKey, id);
      out.push({ id, ok: false, message: `${name}: ${error instanceof ConnectorError ? error.message : "Business Central didn't answer. Nothing was sent; try again."}` });
      if (!(error instanceof ConnectorError)) console.error("settlement journal push failed", error);
    }
  }
  return out;
}

/** CSV of journals (D-70): chosen ids, or every approved one. */
export async function exportCsv(orgKey: string, ids: string[] | "approved"): Promise<{ csv: string; count: number; name: string }> {
  const { views } = await listViews(orgKey);
  const picked = ids === "approved" ? views.filter((v) => v.status === "approved") : views.filter((v) => ids.includes(v.id));
  const csv = journalCsv(picked.reverse().map((v) => ({ draft: v.draft, lines: v.journal.lines })));
  const name = picked.length === 1 ? `journal-${picked[0].marketplace}-${picked[0].settlementId}.csv`.replace(/[^\w.-]+/g, "_") : `settlement-journals-${new Date().toISOString().slice(0, 10)}.csv`;
  return { csv, count: picked.length, name };
}

export const discard = (orgKey: string, id: string) => store.deleteJournal(orgKey, id);
