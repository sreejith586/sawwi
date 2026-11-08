import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AutomationIcon, InvoiceIcon } from "@/components/icons";
import { buttonClass } from "@/components/ui";
import { listCaptures } from "@/lib/automation/purchase-invoices/store";
import { USE_CASES } from "@/lib/automation/use-cases";
import { getCurrentSession } from "@/lib/saas/session";

export const metadata: Metadata = { title: "Automation" };

// The Automation section (D-60): use cases that turn documents into ERP entries. The live one
// opens its workspace; the backlog is shown in value order, marked "Coming soon".

async function LiveCounts() {
  const session = await getCurrentSession();
  if (!session) return null;
  const all = await listCaptures(session.org.key);
  const count = (s: string) => all.filter((c) => c.status === s).length;
  const toReview = count("needs_review") + count("ready");
  return (
    <p className="mt-3 text-xs text-muted">
      {all.length === 0 ? "No invoices yet." : `${toReview} to review · ${count("approved")} approved · ${count("pushed")} sent to the ERP`}
    </p>
  );
}

export default function AutomationPage() {
  const [live, ...soon] = USE_CASES;
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Automation</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Documents in, ERP entries out. Sawwi reads the document and drafts the entry. You review and approve it, then download it or push it to your ERP.
        Nothing is posted without you.
      </p>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">Available now</h2>
        <div className="mt-3 rounded-xl border border-border bg-surface p-5 shadow-sm">
          <div className="flex flex-wrap items-start gap-4">
            <span className="grid size-10 place-items-center rounded-lg bg-brand-soft text-brand">
              <InvoiceIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{live.title}</p>
              <p className="text-xs text-muted">{live.flow}</p>
              <p className="mt-2 max-w-2xl text-sm">{live.summary}</p>
              <Suspense fallback={<p className="mt-3 text-xs text-muted">…</p>}>
                <LiveCounts />
              </Suspense>
            </div>
            <Link href={live.href!} className={buttonClass("primary")}>
              Open
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold">Coming soon</h2>
        <p className="mt-1 text-xs text-muted">In order of value to GCC sellers: how many documents a month, minutes saved on each, and the cost of a mistake.</p>
        <ol className="mt-3 grid gap-3 sm:grid-cols-2">
          {soon.map((u, i) => (
            <li key={u.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-start gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-muted text-xs font-medium text-muted" aria-label={`Rank ${i + 1}`}>
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {u.title}
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-normal text-muted">Coming soon</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted">{u.flow}</p>
                  <p className="mt-2 text-sm">{u.summary}</p>
                  <p className="mt-2 flex gap-1.5 text-xs text-muted">
                    <AutomationIcon className="mt-0.5 size-3.5 text-brand" />
                    <span>{u.value}</span>
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
