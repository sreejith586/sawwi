import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { isDemoOrg } from "@/lib/demo/demo";
import { blobEnabled } from "@/lib/files/storage";
import { incomingFolder } from "@/lib/automation/purchase-invoices/incoming";
import { SAMPLE_SPECS } from "@/lib/automation/purchase-invoices/samples";
import { currentTarget, listViews, pushTargets } from "@/lib/automation/purchase-invoices/service";
import { getMasterData } from "@/lib/automation/purchase-invoices/store";
import { canRun, getCurrentSession } from "@/lib/saas/session";
import { Queue, type QueueRow } from "./queue";

export const metadata: Metadata = { title: "Purchase invoices" };

async function Workspace() {
  await connection();
  const session = await getCurrentSession();
  if (!session) return null;
  const orgKey = session.org.key;
  const [views, targets, target] = await Promise.all([listViews(orgKey), pushTargets(orgKey), currentTarget(orgKey)]);
  const md = target ? await getMasterData(orgKey, target.connectionId) : undefined;
  const rows: QueueRow[] = views.map((v) => ({
    id: v.id,
    fileName: v.fileName,
    status: v.status,
    draft: v.draft,
    blockers: v.review.blockers,
    warnings: v.review.warnings,
    checksOk: v.review.checks.every((c) => c.ok),
    hash: v.hash,
    method: v.source.method,
    layout: v.source.layout ?? null,
    erpNumber: v.erp?.number ?? null,
    createdAt: v.createdAt,
  }));
  const demo = isDemoOrg(orgKey);
  return (
    <Queue
      rows={rows}
      targets={targets}
      target={target ?? null}
      masterFetchedAt={md?.fetchedAt ?? null}
      canEdit={canRun(session.access)}
      demo={demo}
      samples={demo ? SAMPLE_SPECS.map(({ id, title, shows }) => ({ id, title, shows })) : []}
      directUploads={blobEnabled()}
      incomingFolder={incomingFolder(orgKey)}
    />
  );
}

export default function PurchaseInvoicesPage() {
  return (
    <div>
      <Link href="/automation" className="text-sm text-muted hover:text-foreground">
        ← Automation
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Purchase invoices</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Upload supplier invoices as PDFs, including scans. Sawwi reads each one into a draft. Review the drafts, approve them one at a time or in bulk, then
        download them as CSV or push them to Business Central as unposted purchase invoices.
      </p>
      <Suspense fallback={<p className="mt-6 text-muted">Loading invoices…</p>}>
        <Workspace />
      </Suspense>
    </div>
  );
}
