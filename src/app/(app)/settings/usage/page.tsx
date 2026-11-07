import type { Metadata } from "next";
import { Suspense } from "react";
import { UsageDashboard } from "@/components/usage/usage-dashboard";
import { getCurrentSession } from "@/lib/saas/session";
import { parseRange } from "@/lib/usage/aggregate";
import { dashboardData } from "@/lib/usage/report";

export const metadata: Metadata = { title: "Usage & cost" };

// Read-only, so every member sees it, viewers included; it never spends tokens.
async function Usage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range: r } = await searchParams;
  const session = await getCurrentSession();
  if (!session) return null;
  const range = parseRange(r);
  return (
    <div>
      <p className="mb-6 text-sm text-muted">
        What Sawwi&apos;s AI calls cost this workspace: column mapping, report analysis, email drafts and chat. Matching never uses AI, and repeat runs with
        remembered mappings make no calls before the report.
      </p>
      <UsageDashboard admin={false} range={range} basePath="/settings/usage" exportPath="/api/usage" {...(await dashboardData(session.org.key, range))} />
    </div>
  );
}

export default function UsagePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  return (
    <Suspense fallback={<p className="text-muted">Loading usage…</p>}>
      <Usage searchParams={searchParams} />
    </Suspense>
  );
}
