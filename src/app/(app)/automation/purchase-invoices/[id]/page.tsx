import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { currentTarget, getView, masterData } from "@/lib/automation/purchase-invoices/service";
import { getMasterData } from "@/lib/automation/purchase-invoices/store";
import { canRun, getCurrentSession } from "@/lib/saas/session";
import { Review } from "./review";

export const metadata: Metadata = { title: "Review purchase invoice" };

async function Workspace({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const session = await getCurrentSession();
  if (!session) notFound();
  const orgKey = session.org.key;
  const view = await getView(orgKey, id);
  if (!view) notFound();
  const target = await currentTarget(orgKey);
  // Cached for an hour (D-62); if Business Central can't be reached, the last copy will do.
  const md = target ? ((await masterData(orgKey, target.connectionId).catch(() => undefined)) ?? (await getMasterData(orgKey, target.connectionId))) : undefined;
  return (
    <Review
      key={view.updatedAt}
      view={{
        id: view.id,
        fileName: view.fileName,
        status: view.status,
        draft: view.draft,
        hash: view.hash,
        duplicates: view.duplicates,
        source: view.source,
        erp: view.erp,
        approvedAt: view.approvedAt,
        serverBlockers: view.review.blockers.filter((b) => b.includes("already pushed")),
        serverWarnings: view.review.warnings.filter((w) => /duplicate|same supplier and invoice/i.test(w)),
      }}
      target={target ?? null}
      master={md ? { company: md.company, vendors: md.vendors, items: md.items, accounts: md.accounts } : null}
      canEdit={canRun(session.access)}
    />
  );
}

export default function PurchaseInvoicePage(props: PageProps<"/automation/purchase-invoices/[id]">) {
  return (
    <div>
      <Link href="/automation/purchase-invoices" className="text-sm text-muted hover:text-foreground">
        ← Purchase invoices
      </Link>
      <Suspense fallback={<p className="mt-6 text-muted">Loading the invoice…</p>}>
        <Workspace params={props.params} />
      </Suspense>
    </div>
  );
}
