import Papa from "papaparse";
import type { RunContext } from "@/lib/runs/engine";
import { ingestFiles } from "@/lib/runs/engine";
import type { Run } from "@/lib/runs/types";
import { decryptSecret, encryptSecret } from "./crypto";
import { isDemoOrg } from "@/lib/demo/demo";
import { demoDeps, demoSourceFor, demoSourceOffers } from "./mock";
import { assertPublicUrl } from "./net-guard";
import { connectorById } from "./registry";
import * as store from "./store";
import { ConnectorError, type Connector, type ConnectorDeps, type PullWindow } from "./types";

// Connections per workspace: add (validate + test + encrypt), remove, and pull a report
// into a run slot. A pull becomes a CSV "upload", so mapping and matching are unchanged.

export const liveDeps: ConnectorDeps = {
  // https to public addresses only, and no redirects (D-30).
  fetch: async (url, init) => {
    await assertPublicUrl(url);
    return fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) });
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

const aad = (orgKey: string, provider: string) => `sawwi:${orgKey}:${provider}`;

export async function addConnection(orgKey: string, provider: string, input: Record<string, string>, createdBy: string | null, deps: ConnectorDeps = liveDeps) {
  const connector = connectorById(provider);
  if (!connector) throw new ConnectorError("Unknown source.");
  const credentials = connector.parseCredentials(input);
  const { accountLabel } = await connector.test(credentials, deps);
  return await store.insertConnection({ orgKey, provider, accountLabel, secretEnc: encryptSecret(credentials, aad(orgKey, provider)), createdBy });
}

/**
 * A connection ready to call: its connector, decrypted credentials and the deps to use. The demo
 * store's built-in sources (D-32) answer in-process and only in the demo workspace.
 */
export async function openConnection(
  orgKey: string,
  connectionId: string,
  deps: ConnectorDeps = liveDeps,
): Promise<{ connector: Connector; credentials: Record<string, string>; deps: ConnectorDeps; accountLabel: string; demo: boolean }> {
  const demo = demoSourceFor(connectionId);
  if (demo) {
    const connector = connectorById(demo.provider);
    if (!connector || !isDemoOrg(orgKey)) throw new ConnectorError("That connection no longer exists.");
    return { connector, credentials: demo.credentials, deps: demoDeps, accountLabel: demo.accountLabel, demo: true };
  }
  const connection = await store.getConnection(orgKey, connectionId);
  const sealed = connection && await store.getConnectionSecret(orgKey, connectionId);
  const connector = connection && connectorById(connection.provider);
  if (!connection || !sealed || !connector) throw new ConnectorError("That connection no longer exists.");
  return { connector, credentials: decryptSecret<Record<string, string>>(sealed, aad(orgKey, connector.id)), deps, accountLabel: connection.accountLabel, demo: false };
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
  // The demo store's built-in sources (D-32) aren't saved connections and only work there.
  const demo = demoSourceFor(connectionId);
  if (demo && !isDemoOrg(run.orgKey)) throw new ConnectorError("That connection no longer exists.");
  const connection = demo ? undefined : await store.getConnection(run.orgKey, connectionId);
  const sealed = demo ? undefined : await store.getConnectionSecret(run.orgKey, connectionId);
  const connector = connectorById(demo?.provider ?? connection?.provider ?? "");
  if (!connector || (!demo && (!connection || !sealed))) throw new ConnectorError("That connection no longer exists.");
  const provider = connector.id;
  const accountLabel = demo?.accountLabel ?? connection!.accountLabel;
  if (!connector.reports.some((r) => r.id === report) || (demo && !demoSourceOffers(demo, report))) throw new ConnectorError("Unknown report.");
  if (!validWindow(window)) throw new ConnectorError("Pick a period of up to a year, start before end.");

  const log = (rows: number, status: "ok" | "failed", error: string | null) =>
    store.recordSync({ orgKey: run.orgKey, connectionId, report, from: window.from, to: window.to, runId: run.id, slotKey, rows, status, error });
  const fail = async (error: unknown): Promise<never> => {
    await log(0, "failed", error instanceof Error ? error.message : String(error));
    throw error;
  };

  let table: Awaited<ReturnType<typeof connector.pull>>;
  try {
    table = demo
      ? await connector.pull(demo.credentials, report, window, demoDeps)
      : await connector.pull(decryptSecret(sealed!, aad(run.orgKey, provider)), report, window, deps);
  } catch (error) {
    // Auth, scope or provider problems: flag the connection so Settings shows it.
    if (error instanceof ConnectorError && !demo) await store.setConnectionStatus(run.orgKey, connectionId, "needs_attention", error.message);
    return fail(error);
  }
  if (!demo) await store.setConnectionStatus(run.orgKey, connectionId, "connected", null, new Date().toISOString());
  if (table.rows.length === 0) await fail(new ConnectorError(`No ${report} in ${accountLabel} between ${window.from} and ${window.to}.`));

  const csv = Papa.unparse({ fields: table.headers, data: table.rows });
  try {
    await ingestFiles(run, slotKey, [{ name: `${provider}-${report}-${window.from}-to-${window.to}.csv`, data: new TextEncoder().encode(csv) }], ctx);
  } catch (error) {
    await fail(error);
  }
  await log(table.rows.length, "ok", null);
  return { rows: table.rows.length };
}
