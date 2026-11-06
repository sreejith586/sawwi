import Link from "next/link";
import { startScheduledRun } from "@/app/actions/schedules";
import { buttonClass } from "@/components/ui";
import type { ScheduleRow } from "@/lib/schedules/view";

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

/** The "upload this period's files" inbox, on Home and the Schedules page. */
export function DueList({ rows, canStart }: { rows: ScheduleRow[]; canStart: boolean }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${r.state === "started" ? "bg-info" : "bg-warn"}`} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{r.template}</p>
            <p className="text-xs text-muted">
              {r.state === "started"
                ? `Started for ${day(r.when)}. Finish uploading and run it.`
                : `${r.daysLate ? `Due ${day(r.when)}, ${r.daysLate} day${r.daysLate === 1 ? "" : "s"} ago` : `Due today, ${day(r.when)}`}. Upload this period's files.`}
            </p>
          </div>
          {r.state === "started" ? (
            <Link href={`/runs/${r.runId}`} className={buttonClass("secondary")}>
              Continue
            </Link>
          ) : canStart ? (
            <form action={startScheduledRun.bind(null, r.id)}>
              <button type="submit" className={buttonClass("primary")}>
                Start
              </button>
            </form>
          ) : (
            <span className="text-xs text-muted">An editor can start it</span>
          )}
        </li>
      ))}
    </ul>
  );
}
