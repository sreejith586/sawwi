import type { Metadata } from "next";
import { Suspense } from "react";
import { connectorsEnabled } from "@/lib/connectors/crypto";
import { DEMO_SOURCES } from "@/lib/connectors/mock";
import { availableConnectors, CONNECTORS } from "@/lib/connectors/registry";
import { syncRows } from "@/lib/connectors/rows";
import { listConnections } from "@/lib/connectors/store";
import { isDemoOrg } from "@/lib/demo/demo";
import { canManageTeam, getCurrentSession } from "@/lib/saas/session";
import { AddConnection, ConnectionList, OAuthResult, SyncHistory } from "./connections-panel";

export const metadata: Metadata = { title: "Connections" };

async function Connections() {
  const session = await getCurrentSession();
  if (!session) return null;
  const orgKey = session.org.key;
  const labels = Object.fromEntries(CONNECTORS.map((c) => [c.id, c.label]));
  if (isDemoOrg(orgKey)) return <DemoConnections labels={labels} history={await syncRows(orgKey)} />;
  const canManage = canManageTeam(session.access);
  const enabled = connectorsEnabled();
  // Only what the browser needs: no secrets ever leave the server.
  const items = (await listConnections(orgKey)).map(({ id, provider, accountLabel, status, lastError, lastSyncAt, createdAt }) => ({ id, provider, accountLabel, status, lastError, lastSyncAt, createdAt }));
  const connectors = availableConnectors().map(({ id, label, description, fields, oauth }) => ({
    id,
    label,
    description,
    fields,
    ...(oauth ? { oauth: { ready: oauth.app() !== null, envVars: oauth.envVars } } : {}),
  }));

  return (
    <div className="space-y-10">
      <OAuthResult />
      <p className="text-sm text-muted">
        Connect a source once and pull its data straight into a reconciliation instead of exporting and uploading a file. Sawwi only reads, and
        imported data goes through the same column mapping as an upload, so it is remembered next time.
      </p>

      <section>
        <h2 className="text-sm font-semibold">Your connections</h2>
        <div className="mt-3">
          <ConnectionList items={items} canManage={canManage} labels={labels} />
        </div>
      </section>

      {canManage && (
        <section>
          <h2 className="text-sm font-semibold">Add a connection</h2>
          <div className="mt-3">
            {enabled ? (
              <AddConnection connectors={connectors} />
            ) : (
              <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted">
                Connections are switched off on this server: it needs an encryption key for stored tokens (<code>SAWWI_CONNECTOR_KEYS</code>, see the
                README).
              </p>
            )}
          </div>
          <p className="mt-2 text-xs text-muted">More sources (Amazon SP-API, Odoo, Zoho Books, Salla, Zid, payment gateways, bank feeds) are planned.</p>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold">Import history</h2>
        <div className="mt-3">
          <SyncHistory rows={await syncRows(orgKey)} />
        </div>
      </section>
    </div>
  );
}

/** The demo store (D-32): its built-in sources, read-only. Visitors can't add real connections here. */
function DemoConnections({ labels, history }: { labels: Record<string, string>; history: Awaited<ReturnType<typeof syncRows>> }) {
  return (
    <div className="space-y-10">
      <p className="text-sm text-muted">
        This live demo has built-in sources with invented data: two Business Central companies (a trading company and the web store&rsquo;s books), a Magento store, a distributor&rsquo;s books in QuickBooks Online, Xero and NetSuite, and demo files for the other side of
        each reconciliation (marketplace, gateway, courier, warehouse, bank). On a reconciliation, click <strong>Fill with demo data</strong>, or use
        “Import from a connection” on a file. In your own workspace you connect your real systems here.
      </p>
      <section>
        <h2 className="text-sm font-semibold">Demo sources</h2>
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {DEMO_SOURCES.map((d) => (
            <li key={d.id} className="px-4 py-3">
              <p className="text-sm font-medium">{d.accountLabel}</p>
              <p className="text-xs text-muted">{labels[d.provider] ?? d.provider} · built into the demo</p>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="text-sm font-semibold">Import history</h2>
        <div className="mt-3">
          <SyncHistory rows={history} />
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
