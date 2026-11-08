import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import type { PdfCheck, PdfMethod } from "@/lib/pdf/types";
import type { Draft } from "./draft";
import type { MasterData, SupplierProfile } from "./matching";

// All SQL for purchase invoice capture (D-61–D-66). Every query is scoped by org key.

/**
 * needs_review: something blocks approval; ready: nothing blocks, not approved yet;
 * approved: the user signed off on this exact content (D-66); pushing / pushed: sent to the ERP.
 */
export type CaptureStatus = "needs_review" | "ready" | "approved" | "pushing" | "pushed";

/** How the PDF was read, kept for the review screen. */
export type CaptureSource = {
  method: PdfMethod;
  pages: number;
  layout?: "remembered" | "learned";
  checks: PdfCheck[];
  ocr?: { pages: number; confidence: number };
  /** True when the PDF was one of the built-in samples (demo). */
  sample?: boolean;
  /** Set when the AI read this invoice (D-69). */
  ai?: AiSource;
};

export type AiSource = {
  model: string;
  /** Why the AI was asked: what the rules couldn't read or check. */
  reasons: string[];
  /** "ai": the draft is the AI's reading; "rules": the AI's reading checked worse, so the rules' was kept. */
  used: "ai" | "rules";
  /** Fields where the rules and the AI read different values. */
  conflicts: string[];
  notes: string;
  at: string;
};

export type ErpRecord = {
  connectionId: string;
  company: string;
  id: string;
  number: string;
  /** Business Central's own total incl. VAT after it worked out VAT. */
  erpTotal: number | null;
  pushedBy: string;
  pushedAt: string;
};

export type Capture = {
  id: string;
  orgKey: string;
  fileName: string;
  fileHash: string;
  storedPath: string | null;
  issuerKey: string;
  status: CaptureStatus;
  draft: Draft;
  source: CaptureSource;
  approvedHash: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  erp: ErpRecord | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type Row = Record<string, string | number | null>;
const json = <T>(v: string | number | null): T | null => (v === null ? null : (JSON.parse(String(v)) as T));
const now = () => new Date().toISOString();

const toCapture = (r: Row): Capture => ({
  id: String(r.id),
  orgKey: String(r.org_key),
  fileName: String(r.file_name),
  fileHash: String(r.file_hash),
  storedPath: r.stored_path === null ? null : String(r.stored_path),
  issuerKey: String(r.issuer_key),
  status: r.status as CaptureStatus,
  draft: json<Draft>(r.draft_json)!,
  source: json<CaptureSource>(r.source_json)!,
  approvedHash: r.approved_hash === null ? null : String(r.approved_hash),
  approvedBy: r.approved_by === null ? null : String(r.approved_by),
  approvedAt: r.approved_at === null ? null : String(r.approved_at),
  erp: json<ErpRecord>(r.erp_json),
  createdBy: r.created_by === null ? null : String(r.created_by),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

export async function insertCapture(c: Pick<Capture, "orgKey" | "fileName" | "fileHash" | "storedPath" | "issuerKey" | "status" | "draft" | "source" | "createdBy"> & { id?: string }): Promise<Capture> {
  const id = c.id ?? randomUUID();
  const t = now();
  await getDb().run(
    `INSERT INTO purchase_invoices (id, org_key, file_name, file_hash, stored_path, issuer_key, status, draft_json, source_json, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, c.orgKey, c.fileName, c.fileHash, c.storedPath, c.issuerKey, c.status, JSON.stringify(c.draft), JSON.stringify(c.source), c.createdBy, t, t,
  );
  return (await getCapture(c.orgKey, id))!;
}

export async function getCapture(orgKey: string, id: string): Promise<Capture | undefined> {
  const r = await getDb().get<Row>("SELECT * FROM purchase_invoices WHERE org_key = ? AND id = ?", orgKey, id);
  return r && toCapture(r);
}

export async function findByHash(orgKey: string, fileHash: string): Promise<Capture | undefined> {
  const r = await getDb().get<Row>("SELECT * FROM purchase_invoices WHERE org_key = ? AND file_hash = ?", orgKey, fileHash);
  return r && toCapture(r);
}

export async function listCaptures(orgKey: string): Promise<Capture[]> {
  return (await getDb().all<Row>("SELECT * FROM purchase_invoices WHERE org_key = ? ORDER BY created_at DESC, id LIMIT 500", orgKey)).map(toCapture);
}

/** Saves an edited draft. Approval is for content, so any save clears it (D-66). Not once pushed. */
export async function saveDraft(orgKey: string, id: string, draft: Draft, status: CaptureStatus): Promise<boolean> {
  const r = await getDb().run(
    `UPDATE purchase_invoices SET draft_json = ?, status = ?, approved_hash = NULL, approved_by = NULL, approved_at = NULL, updated_at = ?
     WHERE org_key = ? AND id = ? AND status NOT IN ('pushing', 'pushed')`,
    JSON.stringify(draft), status, now(), orgKey, id,
  );
  return r.changes === 1;
}

/** Replaces the draft and how it was read (a re-read). Clears any approval. Not once pushed. */
export async function replaceReading(orgKey: string, id: string, draft: Draft, source: CaptureSource, status: CaptureStatus): Promise<boolean> {
  const r = await getDb().run(
    `UPDATE purchase_invoices SET draft_json = ?, source_json = ?, status = ?, approved_hash = NULL, approved_by = NULL, approved_at = NULL, updated_at = ?
     WHERE org_key = ? AND id = ? AND status NOT IN ('pushing', 'pushed')`,
    JSON.stringify(draft), JSON.stringify(source), status, now(), orgKey, id,
  );
  return r.changes === 1;
}

export async function setStatus(orgKey: string, id: string, status: CaptureStatus) {
  await getDb().run("UPDATE purchase_invoices SET status = ?, updated_at = ? WHERE org_key = ? AND id = ? AND status NOT IN ('pushing', 'pushed')", status, now(), orgKey, id);
}

export async function approve(orgKey: string, id: string, hash: string, userId: string): Promise<boolean> {
  const r = await getDb().run(
    "UPDATE purchase_invoices SET status = 'approved', approved_hash = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE org_key = ? AND id = ? AND status = 'ready'",
    hash, userId, now(), now(), orgKey, id,
  );
  return r.changes === 1;
}

export async function unapprove(orgKey: string, id: string) {
  await getDb().run(
    "UPDATE purchase_invoices SET status = 'ready', approved_hash = NULL, approved_by = NULL, approved_at = NULL, updated_at = ? WHERE org_key = ? AND id = ? AND status = 'approved'",
    now(), orgKey, id,
  );
}

/** Claims an approved draft for a push; false if someone else got there first. A push stuck for 5 minutes can be retried. */
export async function claimForPush(orgKey: string, id: string): Promise<boolean> {
  const stale = new Date(Date.now() - 5 * 60_000).toISOString();
  const r = await getDb().run(
    "UPDATE purchase_invoices SET status = 'pushing', updated_at = ? WHERE org_key = ? AND id = ? AND (status = 'approved' OR (status = 'pushing' AND updated_at < ?))",
    now(), orgKey, id, stale,
  );
  return r.changes === 1;
}

export async function releasePush(orgKey: string, id: string) {
  await getDb().run("UPDATE purchase_invoices SET status = 'approved', updated_at = ? WHERE org_key = ? AND id = ? AND status = 'pushing'", now(), orgKey, id);
}

export async function markPushed(orgKey: string, id: string, erp: ErpRecord) {
  await getDb().run("UPDATE purchase_invoices SET status = 'pushed', erp_json = ?, updated_at = ? WHERE org_key = ? AND id = ?", JSON.stringify(erp), now(), orgKey, id);
}

export async function deleteCapture(orgKey: string, id: string): Promise<Capture | undefined> {
  const c = await getCapture(orgKey, id);
  if (!c || c.status === "pushing" || c.status === "pushed") return undefined;
  await getDb().run("DELETE FROM purchase_invoices WHERE org_key = ? AND id = ?", orgKey, id);
  return c;
}

export async function storedPaths(orgKey: string): Promise<string[]> {
  return (await getDb().all<{ stored_path: string }>("SELECT stored_path FROM purchase_invoices WHERE org_key = ? AND stored_path IS NOT NULL", orgKey)).map((r) => r.stored_path);
}

// ─── Supplier memory ───────────────────────────────────────────────────────

export async function getProfile(orgKey: string, issuerKey: string, trn: string): Promise<SupplierProfile | undefined> {
  const r =
    (await getDb().get<Row>("SELECT profile_json FROM supplier_profiles WHERE org_key = ? AND issuer_key = ?", orgKey, issuerKey)) ??
    (trn ? await getDb().get<Row>("SELECT profile_json FROM supplier_profiles WHERE org_key = ? AND trn = ? ORDER BY updated_at DESC LIMIT 1", orgKey, trn) : undefined);
  return r ? json<SupplierProfile>(r.profile_json)! : undefined;
}

export async function saveProfile(orgKey: string, p: SupplierProfile) {
  await getDb().run(
    `INSERT INTO supplier_profiles (org_key, issuer_key, trn, profile_json, uses, updated_at) VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT (org_key, issuer_key) DO UPDATE SET trn = excluded.trn, profile_json = excluded.profile_json, uses = supplier_profiles.uses + 1, updated_at = excluded.updated_at`,
    orgKey, p.issuerKey, p.trn, JSON.stringify(p), now(),
  );
}

// ─── ERP master data cache and target ─────────────────────────────────────

export async function getMasterData(orgKey: string, connectionId: string): Promise<MasterData | undefined> {
  const r = await getDb().get<Row>("SELECT data_json FROM erp_master_data WHERE org_key = ? AND connection_id = ?", orgKey, connectionId);
  return r ? json<MasterData>(r.data_json)! : undefined;
}

export async function saveMasterData(orgKey: string, connectionId: string, md: MasterData) {
  await getDb().run(
    `INSERT INTO erp_master_data (org_key, connection_id, data_json, fetched_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (org_key, connection_id) DO UPDATE SET data_json = excluded.data_json, fetched_at = excluded.fetched_at`,
    orgKey, connectionId, JSON.stringify(md), md.fetchedAt,
  );
}

export async function getTarget(orgKey: string): Promise<string | null> {
  const r = await getDb().get<Row>("SELECT target_connection FROM automation_prefs WHERE org_key = ?", orgKey);
  return r?.target_connection == null ? null : String(r.target_connection);
}

export async function setTarget(orgKey: string, connectionId: string | null) {
  await getDb().run(
    "INSERT INTO automation_prefs (org_key, target_connection, updated_at) VALUES (?, ?, ?) ON CONFLICT (org_key) DO UPDATE SET target_connection = excluded.target_connection, updated_at = excluded.updated_at",
    orgKey, connectionId, now(),
  );
}
