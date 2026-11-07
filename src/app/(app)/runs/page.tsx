import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PlusIcon } from "@/components/icons";
import { buttonClass } from "@/components/ui";
import { getProfile } from "@/lib/profile/session";
import { orgKeyFor } from "@/lib/runs/access";
import { listRuns } from "@/lib/runs/store";
import { runRows } from "@/lib/tables/run-rows";
import { RunsTable } from "./runs-table";

export const metadata: Metadata = { title: "Reconciliations" };

async function History() {
  const profile = await getProfile();
  if (!profile) return null;
  const rows = await runRows(await listRuns(orgKeyFor(profile)));
  if (rows.length === 0) {
    return (
      <div className="mt-8 rounded-xl border border-dashed border-border p-10 text-center">
        <p className="font-medium">No reconciliations yet</p>
        <p className="mt-1 text-sm text-muted">Pick a template, upload two files and Sawwi does the matching.</p>
        <Link href="/templates" className={`${buttonClass("primary")} mt-5`}>
          Browse templates
        </Link>
      </div>
    );
  }
  return (
    <div className="mt-6">
      <RunsTable rows={rows} />
    </div>
  );
}

export default function RunsPage() {
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reconciliations</h1>
          <p className="mt-1 text-sm text-muted">Every reconciliation you&apos;ve started, newest first.</p>
        </div>
        <Link href="/templates" className={buttonClass("primary")}>
          <PlusIcon className="size-4" />
          New reconciliation
        </Link>
      </div>
      <Suspense fallback={<p className="mt-6 text-muted">Loading reconciliations…</p>}>
        <History />
      </Suspense>
    </div>
  );
}
