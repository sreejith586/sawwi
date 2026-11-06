"use client";

import Link from "next/link";
import { Pill } from "@/components/data-table";
import { QueryTable, type QueryColumn } from "@/components/query-table";
import { ScheduleRowActions } from "@/components/schedules/schedule-actions";
import { SCHEDULE_SEARCH } from "@/lib/schedules/columns";
import type { ScheduleRow } from "@/lib/schedules/view";

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
const TONE = { due: "medium", started: "info", done: "ok", paused: "neutral" } as const;

export function SchedulesTable({ rows, canEdit }: { rows: ScheduleRow[]; canEdit: boolean }) {
  const columns: QueryColumn<ScheduleRow>[] = [
    {
      key: "template",
      header: "Reconciliation",
      render: (r) => (
        <Link href={`/templates/${r.templateId}`} className="font-medium hover:underline">
          {r.template}
        </Link>
      ),
    },
    { key: "cadence", header: "Repeats", cellClass: () => "text-muted" },
    { key: "status", header: "Status", render: (r) => <Pill tone={TONE[r.state]}>{r.status}</Pill> },
    {
      key: "when",
      header: "Due / next",
      render: (r) => (
        <span className="whitespace-nowrap">
          {r.state === "due" || r.state === "started" ? `Due ${day(r.when)}` : `Next ${day(r.when)}`}
        </span>
      ),
    },
    {
      key: "lastRunAt",
      header: "Last run",
      render: (r) =>
        r.runId ? (
          <Link href={`/runs/${r.runId}`} className="whitespace-nowrap text-muted hover:text-foreground hover:underline">
            {day(r.lastRunAt)}
          </Link>
        ) : (
          <span className="whitespace-nowrap text-muted">{r.lastRunAt ? day(r.lastRunAt) : "–"}</span>
        ),
    },
    { key: "runs", header: "Runs", align: "right" },
    ...(canEdit ? [{ key: "id" as const, header: "", sortable: false, render: (r: ScheduleRow) => <ScheduleRowActions id={r.id} paused={r.paused} /> }] : []),
  ];
  return (
    <QueryTable
      rows={rows}
      columns={columns}
      searchFields={[...SCHEDULE_SEARCH]}
      searchPlaceholder="Search schedules"
      filters={[
        { key: "status", label: "Status", allLabel: "All statuses" },
        { key: "group", label: "Type", allLabel: "All types" },
      ]}
      initialSort={{ sort: "when", dir: "asc" }}
      exportHref={(params) => `/api/schedules${params ? `?${params}` : ""}`}
      emptyMessage="No schedules yet."
    />
  );
}
