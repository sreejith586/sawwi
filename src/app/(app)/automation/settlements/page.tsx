import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { BUCKETS } from "@/lib/automation/settlements/buckets";
import { SETTLEMENT_SAMPLES } from "@/lib/automation/settlements/samples";
import { journalTargets, listViews, settlementIncomingFolder } from "@/lib/automation/settlements/service";
import { isDemoOrg } from "@/lib/demo/demo";
import { blobEnabled } from "@/lib/files/storage";
import { canRun, getCurrentSession } from "@/lib/saas/session";
import { SettlementQueue, type SettlementRow } from "./queue";

export const metadata: Metadata = { title: "Marketplace settlements" };
export const maxDuration = 120;

async function Workspace() {
  await connection();
  const session = await getCurrentSession();
  if (!session) return null;
  const orgKey = session.org.key;
  const [{ views, settings, target, erp }, targets] = await Promise.all([listViews(orgKey), journalTargets(orgKey)]);
  const rows: SettlementRow[] = views.map((v) => ({
    id: v.id,
    marketplace: v.marketplace,
    settlementId: v.settlementId,
    fileName: v.fileName,
    status: v.status,
    periodStart: v.draft.periodStart,
    periodEnd: v.draft.periodEnd,
    postingDate: v.draft.postingDate,
    currency: v.draft.currency,
    payout: v.journal.payout,
    categories: v.draft.categories.length,
    unclassified: v.draft.categories.filter((c) => !c.bucket).length,
    lines: v.journal.lines.length,
    checksOk: v.journal.checks.every((c) => c.ok),
    blockers: v.journal.blockers,
    hash: v.hash,
    erp: v.erp ? `${v.erp.lines} lines in ${v.erp.journal}` : null,
  }));
  // Buckets the workspace's settlements use, so the account list shows what matters first.
  const used = new Set(views.flatMap((v) => v.draft.categories.map((c) => c.bucket)).filter(Boolean));
  const demo = isDemoOrg(orgKey);
  return (
    <SettlementQueue
      rows={rows}
      canEdit={canRun(session.access)}
      demo={demo}
      samples={demo ? SETTLEMENT_SAMPLES.map(({ id, title, shows }) => ({ id, title, shows })) : []}
      directUploads={blobEnabled()}
      incomingFolder={settlementIncomingFolder(orgKey)}
      targets={targets}
      target={target ?? null}
      settings={{ accounts: settings.accounts, salesVatRate: settings.salesVatRate, journalId: settings.journalId, accountNames: settings.accountNames }}
      buckets={[{ id: "payout", label: "Payout (clearing or bank)", hint: "The other side of every settlement: what the marketplace paid you.", used: true }, ...BUCKETS.filter((b) => b.id !== "ignore").map((b) => ({ ...b, used: used.has(b.id) }))]}
      erp={erp ? { company: erp.company, lcy: erp.lcy, accounts: erp.accounts, journals: erp.journals, fetchedAt: erp.fetchedAt } : null}
    />
  );
}

export default function SettlementsPage() {
  return (
    <div>
      <Link href="/automation" className="text-sm text-muted hover:text-foreground">
        ← Automation
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Marketplace settlements</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Upload settlement reports from Amazon, Noon or any marketplace (CSV, Excel or PDF). Sawwi turns each settlement into one balanced journal entry: sales,
        refunds, fees, VAT on fees and ads on their accounts, and the payout on your clearing account. Review, approve, then download CSV or add the lines to a
        Business Central journal batch, unposted.
      </p>
      <Suspense fallback={<p className="mt-6 text-muted">Loading settlements…</p>}>
        <Workspace />
      </Suspense>
    </div>
  );
}
