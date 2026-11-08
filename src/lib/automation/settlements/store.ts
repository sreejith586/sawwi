import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { emptySettings, type SettlementDraft, type SettlementSettings } from "./journal";

// All SQL for settlement journals (D-70–D-72). Every query is scoped by org key.

/** As for purchase invoices (D-66): needs_review → ready → approved → pushing → pushed. */
export type JournalStatus = "needs_review" | "ready" | "approved" | "pushing" | "pushed";

export type JournalErpRecord = { connectionId: string; company: string; journal: string; lines: number; pushedBy: string; pushedAt: string };

export type SettlementJournal = {
  id: string;
  orgKey: string;
  marketplace: string;
  settlementId: string;
  fileName: string;
  status: JournalStatus;
  draft: SettlementDraft;
  approvedHash: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  erp: JournalErpRecord | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type Row = Record<string, string | number | null>;
const now = () => new Date().toISOString();
const str = (v: string | number | null) => (v === null ? null : String(v));

const toJournal = (r: Row): SettlementJournal => ({
  id: String(r.id),
  orgKey: String(r.org_key),
  marketplace: String(r.marketplace),
  settlementId: String(r.settlement_id),
  fileName: String(r.file_name),
  status: r.status as JournalStatus,
  draft: JSON.parse(String(r.draft_json)) as SettlementDraft,
  approvedHash: str(r.approved_hash),
  approvedBy: str(r.approved_by),
  approvedAt: str(r.approved_at),
  erp: r.erp_json === null ? null : (JSON.parse(String(r.erp_json)) as JournalErpRecord),
  createdBy: str(r.created_by),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

export async function insertJournal(j: Pick<SettlementJournal, "orgKey" | "fileName" | "status" | "draft" | "createdBy">): Promise<SettlementJournal | undefined> {
  const id = randomUUID();
  const t = now();
  const r = await getDb().run(
    `INSERT INTO settlement_journals (id, org_key, marketplace, settlement_id, file_name, status, draft_json, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (org_key, marketplace, settlement_id) DO NOTHING`,
    id, j.orgKey, j.draft.marketplace, j.draft.settlementId, j.fileName.slice(0, 200), j.status, JSON.stringify(j.draft), j.createdBy, t, t,
  );
  return r.changes === 1 ? getJournal(j.orgKey, id) : undefined;
}

export async function getJournal(orgKey: string, id: string): Promise<SettlementJournal | undefined> {
  const r = await getDb().get<Row>("SELECT * FROM settlement_journals WHERE org_key = ? AND id = ?", orgKey, id);
  return r && toJournal(r);
}

export async function findJournal(orgKey: string, marketplace: string, settlementId: string): Promise<SettlementJournal | undefined> {
  const r = await getDb().get<Row>("SELECT * FROM settlement_journals WHERE org_key = ? AND marketplace = ? AND settlement_id = ?", orgKey, marketplace, settlementId);
  return r && toJournal(r);
}

export async function listJournals(orgKey: string): Promise<SettlementJournal[]> {
  return (await getDb().all<Row>("SELECT * FROM settlement_journals WHERE org_key = ? ORDER BY created_at DESC, settlement_id DESC LIMIT 500", orgKey)).map(toJournal);
}

/** Saves edits; any approval is withdrawn (D-66). Not once pushed. */
export async function saveDraft(orgKey: string, id: string, draft: SettlementDraft, status: JournalStatus): Promise<boolean> {
  const r = await getDb().run(
    `UPDATE settlement_journals SET draft_json = ?, status = ?, approved_hash = NULL, approved_by = NULL, approved_at = NULL, updated_at = ?
     WHERE org_key = ? AND id = ? AND status NOT IN ('pushing', 'pushed')`,
    JSON.stringify(draft), status, now(), orgKey, id,
  );
  return r.changes === 1;
}

/** A status change after the settings changed. An approval stays only if its hash still matches (checked by the caller). */
export async function setStatus(orgKey: string, id: string, status: JournalStatus, clearApproval: boolean) {
  await getDb().run(
    `UPDATE settlement_journals SET status = ?, ${clearApproval ? "approved_hash = NULL, approved_by = NULL, approved_at = NULL," : ""} updated_at = ? WHERE org_key = ? AND id = ? AND status NOT IN ('pushing', 'pushed')`,
    status, now(), orgKey, id,
  );
}

export async function approve(orgKey: string, id: string, hash: string, userId: string): Promise<boolean> {
  const r = await getDb().run(
    "UPDATE settlement_journals SET status = 'approved', approved_hash = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE org_key = ? AND id = ? AND status = 'ready'",
    hash, userId, now(), now(), orgKey, id,
  );
  return r.changes === 1;
}

export async function unapprove(orgKey: string, id: string) {
  await getDb().run("UPDATE settlement_journals SET status = 'ready', approved_hash = NULL, approved_by = NULL, approved_at = NULL, updated_at = ? WHERE org_key = ? AND id = ? AND status = 'approved'", now(), orgKey, id);
}

export async function claimForPush(orgKey: string, id: string): Promise<boolean> {
  const stale = new Date(Date.now() - 5 * 60_000).toISOString();
  const r = await getDb().run(
    "UPDATE settlement_journals SET status = 'pushing', updated_at = ? WHERE org_key = ? AND id = ? AND (status = 'approved' OR (status = 'pushing' AND updated_at < ?))",
    now(), orgKey, id, stale,
  );
  return r.changes === 1;
}

export async function releasePush(orgKey: string, id: string) {
  await getDb().run("UPDATE settlement_journals SET status = 'approved', updated_at = ? WHERE org_key = ? AND id = ? AND status = 'pushing'", now(), orgKey, id);
}

export async function markPushed(orgKey: string, id: string, erp: JournalErpRecord) {
  await getDb().run("UPDATE settlement_journals SET status = 'pushed', erp_json = ?, updated_at = ? WHERE org_key = ? AND id = ?", JSON.stringify(erp), now(), orgKey, id);
}

export async function deleteJournal(orgKey: string, id: string): Promise<boolean> {
  const r = await getDb().run("DELETE FROM settlement_journals WHERE org_key = ? AND id = ? AND status NOT IN ('pushing', 'pushed')", orgKey, id);
  return r.changes === 1;
}

export async function getSettings(orgKey: string): Promise<{ settings: SettlementSettings; target: string | null }> {
  const r = await getDb().get<Row>("SELECT settings_json, target_connection FROM settlement_settings WHERE org_key = ?", orgKey);
  if (!r) return { settings: emptySettings(), target: null };
  return { settings: { ...emptySettings(), ...(JSON.parse(String(r.settings_json)) as SettlementSettings) }, target: str(r.target_connection) };
}

export async function saveSettings(orgKey: string, settings: SettlementSettings, target: string | null) {
  await getDb().run(
    `INSERT INTO settlement_settings (org_key, settings_json, target_connection, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (org_key) DO UPDATE SET settings_json = excluded.settings_json, target_connection = excluded.target_connection, updated_at = excluded.updated_at`,
    orgKey, JSON.stringify(settings), target, now(),
  );
}

// ─── ERP accounts and journal batches, cached an hour per connection (as D-62) ──

export type ErpJournalData = { company: string; lcy: string; accounts: { number: string; name: string }[]; journals: { id: string; code: string; name: string }[]; fetchedAt: string };
const cacheKey = (connectionId: string) => `${connectionId}#journals`;

export async function getErpCache(orgKey: string, connectionId: string): Promise<ErpJournalData | undefined> {
  const r = await getDb().get<Row>("SELECT data_json FROM erp_master_data WHERE org_key = ? AND connection_id = ?", orgKey, cacheKey(connectionId));
  return r ? (JSON.parse(String(r.data_json)) as ErpJournalData) : undefined;
}

export async function saveErpCache(orgKey: string, connectionId: string, data: ErpJournalData) {
  await getDb().run(
    `INSERT INTO erp_master_data (org_key, connection_id, data_json, fetched_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (org_key, connection_id) DO UPDATE SET data_json = excluded.data_json, fetched_at = excluded.fetched_at`,
    orgKey, cacheKey(connectionId), JSON.stringify(data), data.fetchedAt,
  );
}
