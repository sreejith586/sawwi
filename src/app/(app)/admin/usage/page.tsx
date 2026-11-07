import type { Metadata } from "next";
import { Suspense } from "react";
import { UsageDashboard } from "@/components/usage/usage-dashboard";
import { requireSuperadminPage } from "@/lib/saas/admin";
import { parseRange } from "@/lib/usage/aggregate";
import { dashboardData } from "@/lib/usage/report";

export const metadata: Metadata = { title: "Usage · Admin" };

async function Usage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requireSuperadminPage();
  const range = parseRange((await searchParams).range);
  return <UsageDashboard admin range={range} basePath="/admin/usage" exportPath="/api/admin/usage" {...(await dashboardData(null, range))} />;
}

export default function AdminUsagePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  return (
    <Suspense fallback={<p className="text-muted">Loading usage…</p>}>
      <Usage searchParams={searchParams} />
    </Suspense>
  );
}
