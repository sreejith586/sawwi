import Papa from "papaparse";
import type { RunContext } from "@/lib/runs/engine";
import { ingestFiles } from "@/lib/runs/engine";
import type { Run } from "@/lib/runs/types";
import { decryptSecret, encryptSecret } from "./crypto";
import { mockFetchFor } from "./mock";
import { connectorById } from "./registry";
import * as store from "./store";
import { ConnectorError, type ConnectorDeps, type PullWindow } from "./types";

// Connections per workspace: add (validate + test + encrypt), remove, and pull a report
// into a run slot. A pull becomes a CSV "upload", so mapping and matching are unchanged.

export const liveDeps: ConnectorDeps = {
  // In local demo mode a mocked provider answers in-process (never in production; see ./mock).
  fetch: (url, init) => mockFetchFor(url)?.(url, init) ?? fetch(url, { ...init, signal: AbortSignal.timeout(30_000) }),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

const aad = (orgKey: string, provider: string) => `sawwi:${orgKey}:${provider}`;

export async function addConnection(orgKey: string, provider: string, input: Record<string, string>, createdBy: string | null, deps: ConnectorDeps = liveDeps) {
  const connector = connectorById(provider);
  if (!connector) throw new ConnectorError("Unknown source.");
  const credentials = connector.parseCredentials(input);
  const { accountLabel } = await connector.test(credentials, deps);
  return store.insertConnection({ orgKey, provider, accountLabel, secretEnc: encryptSecret(credentials, aad(orgKey, provider)), createdBy });
}

export function validWindow(w: PullWindow): boolean {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(w.from) || !iso.test(w.to) || w.from > w.to) return false;
  return Date.parse(w.to) - Date.parse(w.from) <= 366 * 86_400_000;
}

/** Pulls one report for a window and ingests it into the run's slot as a CSV file. */
export async function pullIntoRun(
  run: Run,
  slotKey: string,
  connectionId: string,
  report: string,
  window: PullWindow,
  ctx: RunContext,
  deps: ConnectorDeps = liveDeps,
): Promise<{ rows: number }> {
  const connection = store.getConnection(run.orgKey, connectionId);
  const sealed = store.getConnectionSecret(run.orgKey, connectionId);
  const connector = connection && connectorById(connection.provider);
  if (!connection || !sealed || !connector) throw new ConnectorError("That connection no longer exists.");
  if (!connector.reports.some((r) => r.id === report)) throw new ConnectorError("Unknown report.");
  if (!validWindow(window)) throw new ConnectorError("Pick a period of up to a year, start before end.");

  const log = (rows: number, status: "ok" | "failed", error: string | null) =>
    store.recordSync({ orgKey: run.orgKey, connectionId, report, from: window.from, to: window.to, runId: run.id, slotKey, rows, status, error });
  const fail = (error: unknown): never => {
    log(0, "failed", error instanceof Error ? error.message : String(error));
    throw error;
  };

  let table: Awaited<ReturnType<typeof connector.pull>>;
  try {
    table = await connector.pull(decryptSecret(sealed, aad(run.orgKey, connection.provider)), report, window, deps);
  } catch (error) {
    // Auth, scope or provider problems: flag the connection so Settings shows it.
    if (error instanceof ConnectorError) store.setConnectionStatus(run.orgKey, connectionId, "needs_attention", error.message);
    return fail(error);
  }
  store.setConnectionStatus(run.orgKey, connectionId, "connected", null, new Date().toISOString());
  if (table.rows.length === 0) fail(new ConnectorError(`No ${report} in ${connection.accountLabel} between ${window.from} and ${window.to}.`));

  const csv = Papa.unparse({ fields: table.headers, data: table.rows });
  try {
    await ingestFiles(run, slotKey, [{ name: `${connection.provider}-${report}-${window.from}-to-${window.to}.csv`, data: new TextEncoder().encode(csv) }], ctx);
  } catch (error) {
    fail(error);
  }
  log(table.rows.length, "ok", null);
  return { rows: table.rows.length };
}
