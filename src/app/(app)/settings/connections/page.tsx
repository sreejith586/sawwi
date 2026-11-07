import type { Metadata } from "next";
import { Suspense } from "react";
import { connectorsEnabled } from "@/lib/connectors/crypto";
import { mockDemoValues } from "@/lib/connectors/mock";
import { CONNECTORS } from "@/lib/connectors/registry";
import { syncRows } from "@/lib/connectors/rows";
import { listConnections } from "@/lib/connectors/store";
import { canManageTeam, getCurrentSession } from "@/lib/saas/session";
import { AddConnection, ConnectionList, SyncHistory } from "./connections-panel";

export const metadata: Metadata = { title: "Connections" };

async function Connections() {
  const session = await getCurrentSession();
  if (!session) return null;
  const orgKey = session.org.key;
  const canManage = canManageTeam(session.access);
  const enabled = connectorsEnabled();
  // Only what the browser needs: no secrets ever leave the server.
  const items = listConnections(orgKey).map(({ id, provider, accountLabel, status, lastError, lastSyncAt, createdAt }) => ({ id, provider, accountLabel, status, lastError, lastSyncAt, createdAt }));
  const connectors = CONNECTORS.map(({ id, label, description, fields }) => ({ id, label, description, fields }));

  return (
    <div className="space-y-10">
      <p className="text-sm text-muted">
        Connect a source once and pull its data straight into a reconciliation instead of exporting and uploading a file. Sawwi only reads, and
        imported data goes through the same column mapping as an upload, so it is remembered next time.
      </p>

      <section>
        <h2 className="text-sm font-semibold">Your connections</h2>
        <div className="mt-3">
          <ConnectionList items={items} canManage={canManage} labels={Object.fromEntries(CONNECTORS.map((c) => [c.id, c.label]))} />
        </div>
      </section>

      {canManage && (
        <section>
          <h2 className="text-sm font-semibold">Add a connection</h2>
          <div className="mt-3">
            {enabled ? (
              <AddConnection connectors={connectors} demoValues={mockDemoValues()} />
            ) : (
              <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted">
                Connections are switched off on this server: it needs an encryption key for stored tokens (<code>SAWWI_CONNECTOR_KEY</code>, see the
                README).
              </p>
            )}
          </div>
          <p className="mt-2 text-xs text-muted">More sources (Magento 2, Amazon SP-API, Odoo, Zoho Books, Salla, Zid, payment gateways, bank feeds) are planned.</p>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold">Import history</h2>
        <div className="mt-3">
          <SyncHistory rows={syncRows(orgKey)} />
        </div>
      </section>
    </div>
  );
}

export default function ConnectionsPage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading connections…</p>}>
      <Connections />
    </Suspense>
  );
}
