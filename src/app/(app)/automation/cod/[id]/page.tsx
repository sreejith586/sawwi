import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getView } from "@/lib/automation/cod/service";
import { canRun, getCurrentSession } from "@/lib/saas/session";
import { RemittanceReviewPage } from "./review";

export const metadata: Metadata = { title: "Review COD remittance" };

async function Workspace({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const session = await getCurrentSession();
  if (!session) notFound();
  const found = await getView(session.org.key, id);
  if (!found) notFound();
  const { view, target } = found;
  return (
    <RemittanceReviewPage
      key={view.updatedAt}
      view={{ id: view.id, courier: view.courier, batchId: view.batchId, fileName: view.fileName, status: view.status, draft: view.draft, review: view.review, hash: view.hash, erp: view.erp, approvedAt: view.approvedAt }}
      target={target ?? null}
      canEdit={canRun(session.access)}
    />
  );
}

export default function RemittancePage(props: PageProps<"/automation/cod/[id]">) {
  return (
    <div>
      <Link href="/automation/cod" className="text-sm text-muted hover:text-foreground">
        ← COD remittances
      </Link>
      <Suspense fallback={<p className="mt-6 text-muted">Loading the remittance…</p>}>
        <Workspace params={props.params} />
      </Suspense>
    </div>
  );
}
