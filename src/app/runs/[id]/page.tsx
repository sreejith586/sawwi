import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getOwnedRun } from "@/lib/runs/access";
import { buildRunView } from "@/lib/runs/view";
import { RunWorkspace } from "./run-workspace";

export const metadata: Metadata = { title: "Reconciliation" };

async function Workspace({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const owned = await getOwnedRun(id);
  const view = owned && buildRunView(id);
  if (!view) notFound();
  return <RunWorkspace initial={view} />;
}

export default function RunPage(props: PageProps<"/runs/[id]">) {
  return (
    <div>
      <Link href="/templates" className="text-sm text-muted hover:text-foreground">
        ← All templates
      </Link>
      <Suspense fallback={<p className="mt-6 text-muted">Loading your reconciliation…</p>}>
        <Workspace params={props.params} />
      </Suspense>
    </div>
  );
}
