import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { importSources } from "@/lib/connectors/sources";
import { isDemoOrg } from "@/lib/demo/demo";
import { getOwnedRun } from "@/lib/runs/access";
import { canRun, getCurrentSession } from "@/lib/saas/session";
import { buildRunView } from "@/lib/runs/view";
import { RunWorkspace } from "./run-workspace";

export const metadata: Metadata = { title: "Reconciliation" };

async function Workspace({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const owned = await getOwnedRun(id);
  const view = owned && await buildRunView(id);
  if (!view) notFound();
  // Importing from a connection is new work on the run: offered to editors and up only.
  const session = await getCurrentSession();
  const editor = Boolean(session && canRun(session.access));
  const sources = session && editor ? await importSources(session.org.key) : [];
  return <RunWorkspace initial={view} sources={sources} demo={editor && isDemoOrg(session?.org.key)} />;
}

export default function RunPage(props: PageProps<"/runs/[id]">) {
  return (
    <div>
      <Link href="/runs" className="text-sm text-muted hover:text-foreground">
        ← Reconciliations
      </Link>
      <Suspense fallback={<p className="mt-6 text-muted">Loading your reconciliation…</p>}>
        <Workspace params={props.params} />
      </Suspense>
    </div>
  );
}
