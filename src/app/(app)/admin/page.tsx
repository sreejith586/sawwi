import type { Metadata } from "next";
import { Suspense } from "react";
import { planById } from "@/lib/saas/plans";
import { requireSuperadminPage } from "@/lib/saas/admin";
import { orgRows } from "@/lib/saas/admin-rows";
import { getSettings, listOpenRequests, listOrgsForAdmin, listUsersForAdmin } from "@/lib/saas/store";
import { keyringStatus } from "@/lib/connectors/keyring";
import { listRecentJobs } from "@/lib/jobs/store";
import { ConnectorKeys } from "./connector-keys";
import { PlatformControls, UpgradeRequests } from "./platform-controls";

export const metadata: Metadata = { title: "Admin" };

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

async function Overview() {
  await requireSuperadminPage();
  const settings = await getSettings();
  const orgs = await listOrgsForAdmin();
  const users = await listUsersForAdmin();
  const requests = await listOpenRequests();
  const keys = await keyringStatus();
  const jobs = await listRecentJobs(15);
  const rows = orgRows(orgs);
  const onTrial = rows.filter((o) => o.trialState === "Active").length;
  const trialEnded = rows.filter((o) => o.trialState === "Ended").length;
  const paying = rows.filter((o) => o.planId !== "trial").length;

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Workspaces" value={orgs.length} />
        <Stat label="Users" value={users.length} />
        <Stat label="On trial" value={onTrial} />
        <Stat label="Trial ended" value={trialEnded} tone={trialEnded ? "text-warn" : undefined} />
        <Stat label="On a paid plan" value={paying} tone={paying ? "text-success" : undefined} />
      </div>

      <section>
        <h2 className="text-sm font-semibold">Platform</h2>
        <div className="mt-3">
          <PlatformControls paywallEnabled={settings.paywallEnabled} signupsOpen={settings.signupsOpen} trialDays={settings.trialDays} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">Plan requests · {requests.length}</h2>
        <p className="mt-0.5 text-sm text-muted">No payment provider is connected yet, so plans are switched here once payment is arranged.</p>
        <div className="mt-3">
          <UpgradeRequests requests={requests.map((r) => ({ id: r.id, org: r.orgName, requester: r.requester, plan: planById(r.plan).name, createdAt: day(r.createdAt) }))} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">Connection secrets</h2>
        <p className="mt-0.5 text-sm text-muted">Connection tokens are encrypted at rest under a named key; rotate it here.</p>
        <div className="mt-3">
          <ConnectorKeys status={keys} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">Background jobs</h2>
        <p className="mt-0.5 text-sm text-muted">Run every 15 minutes by Vercel Cron: the demo reset, cleanup of abandoned uploads (D-42).</p>
        <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface">
          {jobs.length === 0 ? (
            <p className="p-5 text-sm text-muted">Nothing has run yet. On Vercel this needs CRON_SECRET (docs/DEPLOY.md).</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Job</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Tries</th>
                  <th className="px-4 py-2 font-medium">Queued</th>
                  <th className="px-4 py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="px-4 py-2 font-medium">{j.key}</td>
                    <td className={`px-4 py-2 ${j.status === "failed" ? "text-danger" : j.status === "done" ? "text-success" : "text-warn"}`}>{j.status}</td>
                    <td className="tabular px-4 py-2">{j.attempts}</td>
                    <td className="px-4 py-2 text-muted">{day(j.createdAt)}</td>
                    <td className="max-w-xs truncate px-4 py-2 text-muted">{j.lastError ?? (j.result ? JSON.stringify(j.result) : "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`tabular mt-1.5 text-xl font-semibold tracking-tight ${tone ?? ""}`}>{value.toLocaleString("en-US")}</p>
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <Overview />
    </Suspense>
  );
}
