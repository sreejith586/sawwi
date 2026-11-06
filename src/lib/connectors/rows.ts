import { connectorById } from "./registry";
import { listConnections, listSyncs } from "./store";

// Sync history rows, shared by Settings → Connections and its Excel export.

export type SyncRow = {
  id: string;
  at: string;
  connection: string;
  report: string;
  from: string;
  to: string;
  rows: number;
  status: string;
  runId: string;
  error: string;
};

export function syncRows(orgKey: string): SyncRow[] {
  const names = new Map(listConnections(orgKey).map((c) => [c.id, `${connectorById(c.provider)?.label ?? c.provider}: ${c.accountLabel}`]));
  return listSyncs(orgKey).map((s) => ({
    id: String(s.id),
    at: s.createdAt,
    connection: names.get(s.connectionId) ?? "Removed connection",
    report: s.report,
    from: s.from,
    to: s.to,
    rows: s.rows,
    status: s.status === "ok" ? "Imported" : "Failed",
    runId: s.runId ?? "",
    error: s.error ?? "",
  }));
}

export { SYNC_FILTERS, SYNC_SEARCH } from "./columns";
