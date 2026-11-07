import type { Metadata } from "next";
import { Suspense } from "react";
import { requireSuperadminPage } from "@/lib/saas/admin";
import { orgRows } from "@/lib/saas/admin-rows";
import { listOrgsForAdmin } from "@/lib/saas/store";
import { WorkspacesTable } from "./workspaces-table";

export const metadata: Metadata = { title: "Workspaces · Admin" };

async function Workspaces() {
  await requireSuperadminPage();
  return <WorkspacesTable rows={orgRows(await listOrgsForAdmin())} />;
}

export default function AdminWorkspacesPage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading workspaces…</p>}>
      <Workspaces />
    </Suspense>
  );
}
