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

export function insertConnection(c: { orgKey: string; provider: string; accountLabel: string; secretEnc: string; createdBy: string | null }): Connection {
  const id = randomUUID();
  getDb()
    .prepare("INSERT INTO connections (id, org_key, provider, account_label, secret_enc, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'connected', ?, ?)")
    .run(id, c.orgKey, c.provider, c.accountLabel, c.secretEnc, c.createdBy, new Date().toISOString());
  return getConnection(c.orgKey, id)!;
}

export function getConnection(orgKey: string, id: string): Connection | undefined {
  const r = getDb().prepare("SELECT * FROM connections WHERE id = ? AND org_key = ?").get(id, orgKey) as Row | undefined;
  return r ? toConnection(r) : undefined;
}

export function getConnectionSecret(orgKey: string, id: string): string | undefined {
  const r = getDb().prepare("SELECT secret_enc FROM connections WHERE id = ? AND org_key = ?").get(id, orgKey) as Row | undefined;
  return r ? String(r.secret_enc) : undefined;
}

export function listConnections(orgKey: string): Connection[] {
  return (getDb().prepare("SELECT * FROM connections WHERE org_key = ? ORDER BY created_at").all(orgKey) as Row[]).map(toConnection);
}

export function setConnectionStatus(orgKey: string, id: string, status: ConnectionStatus, error: string | null, syncedAt?: string) {
  getDb()
    .prepare("UPDATE connections SET status = ?, last_error = ?, last_sync_at = COALESCE(?, last_sync_at) WHERE id = ? AND org_key = ?")
    .run(status, error, syncedAt ?? null, id, orgKey);
}

/** Deletes the connection and its secret. Sync history is kept for the audit trail. */
export function deleteConnection(orgKey: string, id: string) {
  getDb().prepare("DELETE FROM connections WHERE id = ? AND org_key = ?").run(id, orgKey);
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

export function recordSync(s: Omit<SyncRecord, "id" | "createdAt"> & { orgKey: string }) {
  getDb()
    .prepare(
      `INSERT INTO connection_syncs (connection_id, org_key, report, window_from, window_to, run_id, slot_key, rows, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(s.connectionId, s.orgKey, s.report, s.from, s.to, s.runId, s.slotKey, s.rows, s.status, s.error, new Date().toISOString());
}

export function listSyncs(orgKey: string, limit = 500): SyncRecord[] {
  const rows = getDb().prepare("SELECT * FROM connection_syncs WHERE org_key = ? ORDER BY id DESC LIMIT ?").all(orgKey, limit) as Row[];
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
