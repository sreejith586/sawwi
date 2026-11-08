import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";

// All SQL for connections (D-28). The encrypted secret never leaves this module except
// to the service that decrypts it for a pull; listing functions don't return it.

type Row = Record<string, string | number | null>;

export type ConnectionStatus = "connected" | "needs_attention";

export type Connection = {
  id: string;
  orgKey: string;
  provider: string;
  accountLabel: string;
  status: ConnectionStatus;
  lastError: string | null;
  lastSyncAt: string | null;
  createdAt: string;
};

const toConnection = (r: Row): Connection => ({
  id: String(r.id),
  orgKey: String(r.org_key),
  provider: String(r.provider),
  accountLabel: String(r.account_label),
  status: r.status as ConnectionStatus,
  lastError: r.last_error === null ? null : String(r.last_error),
  lastSyncAt: r.last_sync_at === null ? null : String(r.last_sync_at),
  createdAt: String(r.created_at),
});

export async function insertConnection(c: { orgKey: string; provider: string; accountLabel: string; secretEnc: string; createdBy: string | null }): Promise<Connection> {
  const id = randomUUID();
  await getDb().run("INSERT INTO connections (id, org_key, provider, account_label, secret_enc, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'connected', ?, ?)", id, c.orgKey, c.provider, c.accountLabel, c.secretEnc, c.createdBy, new Date().toISOString());
  return (await getConnection(c.orgKey, id))!;
}

export async function getConnection(orgKey: string, id: string): Promise<Connection | undefined> {
  const r = (await getDb().get("SELECT * FROM connections WHERE id = ? AND org_key = ?", id, orgKey)) as Row | undefined;
  return r ? toConnection(r) : undefined;
}

export async function getConnectionSecret(orgKey: string, id: string): Promise<string | undefined> {
  const r = (await getDb().get("SELECT secret_enc FROM connections WHERE id = ? AND org_key = ?", id, orgKey)) as Row | undefined;
  return r ? String(r.secret_enc) : undefined;
}

export async function listConnections(orgKey: string): Promise<Connection[]> {
  return ((await getDb().all("SELECT * FROM connections WHERE org_key = ? ORDER BY created_at", orgKey)) as Row[]).map(toConnection);
}

export async function setConnectionStatus(orgKey: string, id: string, status: ConnectionStatus, error: string | null, syncedAt?: string) {
  await getDb().run("UPDATE connections SET status = ?, last_error = ?, last_sync_at = COALESCE(?, last_sync_at) WHERE id = ? AND org_key = ?", status, error, syncedAt ?? null, id, orgKey);
}

/** Deletes the connection and its secret. Sync history is kept for the audit trail. */
export async function deleteConnection(orgKey: string, id: string) {
  await getDb().run("DELETE FROM connections WHERE id = ? AND org_key = ?", id, orgKey);
  // Vendors, items and accounts cached for purchase invoice capture (D-62) go with it.
  await getDb().run("DELETE FROM erp_master_data WHERE connection_id = ? AND org_key = ?", id, orgKey);
}

export type SyncRecord = {
  id: number;
  connectionId: string;
  report: string;
  from: string;
  to: string;
  runId: string | null;
  slotKey: string | null;
  rows: number;
  status: "ok" | "failed";
  error: string | null;
  createdAt: string;
};

export async function recordSync(s: Omit<SyncRecord, "id" | "createdAt"> & { orgKey: string }) {
  (await getDb().run(`INSERT INTO connection_syncs (connection_id, org_key, report, window_from, window_to, run_id, slot_key, rows, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, s.connectionId, s.orgKey, s.report, s.from, s.to, s.runId, s.slotKey, s.rows, s.status, s.error, new Date().toISOString()));
}

export async function listSyncs(orgKey: string, limit = 500): Promise<SyncRecord[]> {
  const rows = (await getDb().all("SELECT * FROM connection_syncs WHERE org_key = ? ORDER BY id DESC LIMIT ?", orgKey, limit)) as Row[];
  return rows.map((r) => ({
    id: Number(r.id),
    connectionId: String(r.connection_id),
    report: String(r.report),
    from: String(r.window_from),
    to: String(r.window_to),
    runId: r.run_id === null ? null : String(r.run_id),
    slotKey: r.slot_key === null ? null : String(r.slot_key),
    rows: Number(r.rows),
    status: r.status as "ok" | "failed",
    error: r.error === null ? null : String(r.error),
    createdAt: String(r.created_at),
  }));
}

// ─── Key rotation (D-40): every workspace's sealed secrets, superadmin only ─────────

export type SealedSecret = { id: string; orgKey: string; provider: string; secretEnc: string };

export async function listAllSealedSecrets(): Promise<SealedSecret[]> {
  const rows = await getDb().all<Row>("SELECT id, org_key, provider, secret_enc FROM connections ORDER BY created_at");
  return rows.map((r) => ({ id: String(r.id), orgKey: String(r.org_key), provider: String(r.provider), secretEnc: String(r.secret_enc) }));
}

/** Replaces a secret only if it hasn't changed since it was read. */
export async function replaceSealedSecret(id: string, previous: string, next: string): Promise<boolean> {
  return (await getDb().run("UPDATE connections SET secret_enc = ? WHERE id = ? AND secret_enc = ?", next, id, previous)).changes === 1;
}
