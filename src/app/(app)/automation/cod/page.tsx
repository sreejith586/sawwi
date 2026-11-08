import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { COD_SAMPLES } from "@/lib/automation/cod/samples";
import { codIncomingFolder, codTargets, listViews } from "@/lib/automation/cod/service";
import { isDemoOrg } from "@/lib/demo/demo";
import { blobEnabled } from "@/lib/files/storage";
import { canRun, getCurrentSession } from "@/lib/saas/session";
import { CodQueue, type CodRow } from "./queue";

export const metadata: Metadata = { title: "COD remittances" };
export const maxDuration = 120;

async function Workspace() {
  await connection();
  const session = await getCurrentSession();
  if (!session) return null;
  const orgKey = session.org.key;
  const [{ views, settings, target, erp }, targets] = await Promise.all([listViews(orgKey), codTargets(orgKey)]);
  const rows: CodRow[] = views.map((v) => ({
    id: v.id,
    courier: v.courier,
    batchId: v.batchId,
    status: v.status,
    postingDate: v.draft.postingDate,
    currency: v.draft.currency,
    parcels: v.draft.parcels.length,
    undecided: v.draft.parcels.filter((p) => !p.action).length,
    flagged: Object.keys(v.review.flags).length,
    totals: v.review.totals,
    checksOk: v.review.checks.every((c) => c.ok),
    blockers: v.review.blockers,
    hash: v.hash,
    erp: v.erp ? `${v.erp.payments} payments in ${v.erp.paymentJournal}` : null,
  }));
  const demo = isDemoOrg(orgKey);
  return (
    <CodQueue
      rows={rows}
      canEdit={canRun(session.access)}
      demo={demo}
      samples={demo ? COD_SAMPLES.map(({ id, title, shows }) => ({ id, title, shows })) : []}
      directUploads={blobEnabled()}
      incomingFolder={codIncomingFolder(orgKey)}
      targets={targets}
      target={target ?? null}
      settings={{ accounts: settings.accounts, defaultCustomer: settings.defaultCustomer, paymentJournalId: settings.paymentJournalId, generalJournalId: settings.generalJournalId }}
      erp={erp ?? null}
    />
  );
}

export default function CodPage() {
  return (
    <div>
      <Link href="/automation" className="text-sm text-muted hover:text-foreground">
        ← Automation
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">COD remittances</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Upload your couriers&apos; cash-on-delivery remittance reports (Aramex, SMSA, J&amp;T, Quiqup, iMile or any other). Sawwi matches every parcel to its
        sales invoice and applies the cash, flags parcels collected short, never invoiced or already paid, and books the courier&apos;s fees. Review, approve,
        then download CSV or add the payments and journal to Business Central, unposted.
      </p>
      <Suspense fallback={<p className="mt-6 text-muted">Loading remittances…</p>}>
        <Workspace />
      </Suspense>
    </div>
  );
}
