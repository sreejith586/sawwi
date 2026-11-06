import { Suspense } from "react";
import { requireSuperadminPage } from "@/lib/saas/admin";
import { AdminTabs } from "./admin-tabs";

// The whole console, heading included, renders only for superadmins; everyone else gets a 404.
async function AdminShell({ children }: { children: React.ReactNode }) {
  await requireSuperadminPage();
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Admin console</h1>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted">Superadmin</span>
      </div>
      <Suspense fallback={<AdminTabs static />}>
        <AdminTabs />
      </Suspense>
      <div className="mt-8">{children}</div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}
