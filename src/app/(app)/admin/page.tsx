import type { Metadata } from "next";
import { Suspense } from "react";
import { planById } from "@/lib/saas/plans";
import { requireSuperadminPage } from "@/lib/saas/admin";
import { orgRows } from "@/lib/saas/admin-rows";
import { getSettings, listOpenRequests, listOrgsForAdmin, listUsersForAdmin } from "@/lib/saas/store";
import { keyringStatus } from "@/lib/connectors/keyring";
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
