import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BUCKETS } from "@/lib/automation/settlements/buckets";
import { getView } from "@/lib/automation/settlements/service";
import { canRun, getCurrentSession } from "@/lib/saas/session";
import { SettlementReview } from "./review";

export const metadata: Metadata = { title: "Review settlement" };

async function Workspace({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const session = await getCurrentSession();
  if (!session) notFound();
  const found = await getView(session.org.key, id);
  if (!found) notFound();
  const { view, target } = found;
  return (
    <SettlementReview
      key={view.updatedAt}
      view={{
        id: view.id,
        marketplace: view.marketplace,
        settlementId: view.settlementId,
        fileName: view.fileName,
        status: view.status,
        draft: view.draft,
        journal: view.journal,
        hash: view.hash,
        erp: view.erp,
        approvedAt: view.approvedAt,
      }}
      buckets={BUCKETS.map(({ id, label, hint }) => ({ id, label, hint }))}
      target={target ?? null}
      canEdit={canRun(session.access)}
    />
  );
}

export default function SettlementPage(props: PageProps<"/automation/settlements/[id]">) {
  return (
    <div>
      <Link href="/automation/settlements" className="text-sm text-muted hover:text-foreground">
        ← Marketplace settlements
      </Link>
      <Suspense fallback={<p className="mt-6 text-muted">Loading the settlement…</p>}>
        <Workspace params={props.params} />
      </Suspense>
    </div>
  );
}
