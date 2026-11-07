import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DueList } from "@/components/schedules/due-list";
import { buttonClass } from "@/components/ui";
import { canRun, getCurrentSession } from "@/lib/saas/session";
import { dueSchedules, scheduleRows } from "@/lib/schedules/view";
import { SchedulesTable } from "./schedules-table";

export const metadata: Metadata = { title: "Schedules" };

async function Schedules() {
  const session = await getCurrentSession();
  if (!session) return null;
  const orgKey = session.org.key;
  const rows = await scheduleRows(orgKey);
  const due = await dueSchedules(orgKey);
  const canEdit = canRun(session.access);

  if (rows.length === 0) {
    return (
      <div className="mt-8 rounded-xl border border-dashed border-border p-10 text-center">
        <p className="font-medium">No schedules yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">
          Open a template and choose &quot;Remind us every week or month&quot;. When it&apos;s due it shows up here and on Home, ready for that
          period&apos;s files, and your saved column mappings are reused.
        </p>
        <Link href="/templates" className={`${buttonClass("primary")} mt-5`}>
          Browse templates
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-8">
      <section>
        <h2 className="text-sm font-semibold">Due now · {due.length}</h2>
        <div className="mt-3">
          {due.length ? <DueList rows={due} canStart={canEdit} /> : <p className="text-sm text-muted">Nothing due. You&apos;re up to date.</p>}
        </div>
      </section>
      <section>
        <h2 className="text-sm font-semibold">All schedules</h2>
        <div className="mt-3">
          <SchedulesTable rows={rows} canEdit={canEdit} />
        </div>
      </section>
    </div>
  );
}

export default function SchedulesPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Schedules</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Recurring reconciliations. Each one comes due weekly or monthly; start it, upload that period&apos;s files and Sawwi reuses the column
        mappings it saved last time. Dates are in UTC.
      </p>
      <Suspense fallback={<p className="mt-6 text-muted">Loading schedules…</p>}>
        <Schedules />
      </Suspense>
    </div>
  );
}
