import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { emptyCodSettings, type CodSettings, type RemittanceDraft } from "./remittance";

// All SQL for COD remittances (D-74). Every query is scoped by org key.

export type CodStatus = "needs_review" | "ready" | "approved" | "pushing" | "pushed";
export type CodErpRecord = { connectionId: string; company: string; paymentJournal: string; generalJournal: string; payments: number; glLines: number; pushedBy: string; pushedAt: string };

export type Remittance = {
  id: string;
  orgKey: string;
  courier: string;
  batchId: string;
  fileName: string;
  status: CodStatus;
  draft: RemittanceDraft;
  approvedHash: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  erp: CodErpRecord | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type Row = Record<string, string | number | null>;
const now = () => new Date().toISOString();
const str = (v: string | number | null) => (v === null ? null : String(v));

const toRemittance = (r: Row): Remittance => ({
  id: String(r.id),
  orgKey: String(r.org_key),
  courier: String(r.courier),
  batchId: String(r.batch_id),
  fileName: String(r.file_name),
  status: r.status as CodStatus,
  draft: JSON.parse(String(r.draft_json)) as RemittanceDraft,
  approvedHash: str(r.approved_hash),
  approvedBy: str(r.approved_by),
  approvedAt: str(r.approved_at),
  erp: r.erp_json === null ? null : (JSON.parse(String(r.erp_json)) as CodErpRecord),
  createdBy: str(r.created_by),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

export async function insertRemittance(x: Pick<Remittance, "orgKey" | "fileName" | "status" | "draft" | "createdBy">): Promise<Remittance | undefined> {
  const id = randomUUID();
  const t = now();
  const r = await getDb().run(
    `INSERT INTO cod_remittances (id, org_key, courier, batch_id, file_name, status, draft_json, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (org_key, courier, batch_id) DO NOTHING`,
    id, x.orgKey, x.draft.courier, x.draft.batchId, x.fileName.slice(0, 200), x.status, JSON.stringify(x.draft), x.createdBy, t, t,
  );
  return r.changes === 1 ? getRemittance(x.orgKey, id) : undefined;
}

export async function getRemittance(orgKey: string, id: string): Promise<Remittance | undefined> {
  const r = await getDb().get<Row>("SELECT * FROM cod_remittances WHERE org_key = ? AND id = ?", orgKey, id);
  return r && toRemittance(r);
}

export async function findRemittance(orgKey: string, courier: string, batchId: string): Promise<Remittance | undefined> {
  const r = await getDb().get<Row>("SELECT * FROM cod_remittances WHERE org_key = ? AND courier = ? AND batch_id = ?", orgKey, courier, batchId);
  return r && toRemittance(r);
}

export async function listRemittances(orgKey: string): Promise<Remittance[]> {
  return (await getDb().all<Row>("SELECT * FROM cod_remittances WHERE org_key = ? ORDER BY created_at DESC, batch_id DESC LIMIT 500", orgKey)).map(toRemittance);
}

export async function saveDraft(orgKey: string, id: string, draft: RemittanceDraft, status: CodStatus): Promise<boolean> {
  const r = await getDb().run(
    `UPDATE cod_remittances SET draft_json = ?, status = ?, approved_hash = NULL, approved_by = NULL, approved_at = NULL, updated_at = ?
     WHERE org_key = ? AND id = ? AND status NOT IN ('pushing', 'pushed')`,
    JSON.stringify(draft), status, now(), orgKey, id,
  );
  return r.changes === 1;
}

export async function setStatus(orgKey: string, id: string, status: CodStatus, clearApproval: boolean) {
  await getDb().run(
    `UPDATE cod_remittances SET status = ?, ${clearApproval ? "approved_hash = NULL, approved_by = NULL, approved_at = NULL," : ""} updated_at = ? WHERE org_key = ? AND id = ? AND status NOT IN ('pushing', 'pushed')`,
    status, now(), orgKey, id,
  );
}

export async function approve(orgKey: string, id: string, hash: string, userId: string): Promise<boolean> {
  const r = await getDb().run(
    "UPDATE cod_remittances SET status = 'approved', approved_hash = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE org_key = ? AND id = ? AND status = 'ready'",
    hash, userId, now(), now(), orgKey, id,
  );
  return r.changes === 1;
}

export async function unapprove(orgKey: string, id: string) {
  await getDb().run("UPDATE cod_remittances SET status = 'ready', approved_hash = NULL, approved_by = NULL, approved_at = NULL, updated_at = ? WHERE org_key = ? AND id = ? AND status = 'approved'", now(), orgKey, id);
}

export async function claimForPush(orgKey: string, id: string): Promise<boolean> {
  const stale = new Date(Date.now() - 5 * 60_000).toISOString();
  const r = await getDb().run(
    "UPDATE cod_remittances SET status = 'pushing', updated_at = ? WHERE org_key = ? AND id = ? AND (status = 'approved' OR (status = 'pushing' AND updated_at < ?))",
    now(), orgKey, id, stale,
  );
  return r.changes === 1;
}

export async function releasePush(orgKey: string, id: string) {
  await getDb().run("UPDATE cod_remittances SET status = 'approved', updated_at = ? WHERE org_key = ? AND id = ? AND status = 'pushing'", now(), orgKey, id);
}

export async function markPushed(orgKey: string, id: string, erp: CodErpRecord) {
  await getDb().run("UPDATE cod_remittances SET status = 'pushed', erp_json = ?, updated_at = ? WHERE org_key = ? AND id = ?", JSON.stringify(erp), now(), orgKey, id);
}

export async function deleteRemittance(orgKey: string, id: string): Promise<boolean> {
  const r = await getDb().run("DELETE FROM cod_remittances WHERE org_key = ? AND id = ? AND status NOT IN ('pushing', 'pushed')", orgKey, id);
  return r.changes === 1;
}

export async function getSettings(orgKey: string): Promise<{ settings: CodSettings; target: string | null }> {
  const r = await getDb().get<Row>("SELECT settings_json, target_connection FROM cod_settings WHERE org_key = ?", orgKey);
  if (!r) return { settings: emptyCodSettings(), target: null };
  return { settings: { ...emptyCodSettings(), ...(JSON.parse(String(r.settings_json)) as CodSettings) }, target: str(r.target_connection) };
}

export async function saveSettings(orgKey: string, settings: CodSettings, target: string | null) {
  await getDb().run(
    `INSERT INTO cod_settings (org_key, settings_json, target_connection, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (org_key) DO UPDATE SET settings_json = excluded.settings_json, target_connection = excluded.target_connection, updated_at = excluded.updated_at`,
    orgKey, JSON.stringify(settings), target, now(),
  );
}

export type CodErpData = {
  company: string;
  lcy: string;
  accounts: { number: string; name: string }[];
  customers: { number: string; name: string }[];
  paymentJournals: { id: string; code: string; name: string }[];
  generalJournals: { id: string; code: string; name: string }[];
  fetchedAt: string;
};
const cacheKey = (connectionId: string) => `${connectionId}#cod`;

export async function getErpCache(orgKey: string, connectionId: string): Promise<CodErpData | undefined> {
  const r = await getDb().get<Row>("SELECT data_json FROM erp_master_data WHERE org_key = ? AND connection_id = ?", orgKey, cacheKey(connectionId));
  return r ? (JSON.parse(String(r.data_json)) as CodErpData) : undefined;
}

export async function saveErpCache(orgKey: string, connectionId: string, data: CodErpData) {
  await getDb().run(
    `INSERT INTO erp_master_data (org_key, connection_id, data_json, fetched_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (org_key, connection_id) DO UPDATE SET data_json = excluded.data_json, fetched_at = excluded.fetched_at`,
    orgKey, cacheKey(connectionId), JSON.stringify(data), data.fetchedAt,
  );
}
