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
  const connections = listConnections(orgKey);
  const names = new Map(connections.map((c) => [c.id, `${connectorById(c.provider)?.label ?? c.provider}: ${c.accountLabel}`]));
  const reportLabel = (connectionId: string, report: string) => {
    const provider = connections.find((c) => c.id === connectionId)?.provider;
    return (provider && connectorById(provider)?.reports.find((r) => r.id === report)?.label) || report;
  };
  return listSyncs(orgKey).map((s) => ({
    id: String(s.id),
    at: s.createdAt,
    connection: names.get(s.connectionId) ?? "Removed connection",
    report: reportLabel(s.connectionId, s.report),
    from: s.from,
    to: s.to,
    rows: s.rows,
    status: s.status === "ok" ? "Imported" : "Failed",
    runId: s.runId ?? "",
    error: s.error ?? "",
  }));
}

export { SYNC_FILTERS, SYNC_SEARCH } from "./columns";
