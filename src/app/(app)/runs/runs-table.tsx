"use client";

import Link from "next/link";
import { Pill } from "@/components/data-table";
import { QueryTable, type QueryColumn } from "@/components/query-table";
import { RUN_STATUS } from "@/lib/runs/status";
import type { RunStatus } from "@/lib/runs/types";
import { RUN_SEARCH } from "@/lib/tables/run-columns";
import type { RunRow } from "@/lib/tables/run-rows";

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const columns: QueryColumn<RunRow>[] = [
  {
    key: "template",
    header: "Reconciliation",
    render: (r) => (
      <Link href={`/runs/${r.id}`} className="font-medium hover:underline">
        {r.template}
      </Link>
    ),
  },
  { key: "group", header: "Type", cellClass: () => "text-muted" },
  { key: "status", header: "Status", render: (r) => <Pill tone={RUN_STATUS[r.statusKey as RunStatus].tone}>{r.status}</Pill> },
  { key: "started", header: "Started", render: (r) => <span className="whitespace-nowrap text-muted">{r.startedLabel}</span> },
  { key: "files", header: "Files", align: "right" },
  {
    key: "exceptions",
    header: "Exceptions",
    align: "right",
    render: (r) => (r.exceptions === "" ? <span className="text-muted">–</span> : r.exceptions.toLocaleString("en-US")),
    cellClass: (r) => (r.exceptions === "" ? "" : r.exceptions > 0 ? "text-danger font-medium" : "text-success font-medium"),
  },
  {
    key: "value",
    header: "Value flagged",
    align: "right",
    render: (r) => (r.value === "" ? <span className="text-muted">–</span> : `${r.currency ? `${r.currency} ` : ""}${money(r.value)}`),
    cellClass: (r) => (r.value === "" ? "" : r.value > 0 ? "text-danger" : "text-success"),
  },
];

export function RunsTable({ rows }: { rows: RunRow[] }) {
  return (
    <QueryTable
      rows={rows}
      columns={columns}
      searchFields={[...RUN_SEARCH]}
      searchPlaceholder="Search reconciliations"
      filters={[
        { key: "status", label: "Status", allLabel: "All statuses" },
        { key: "group", label: "Type", allLabel: "All types" },
      ]}
      initialSort={{ sort: "started", dir: "desc" }}
      exportHref={(params) => `/api/runs${params ? `?${params}` : ""}`}
      emptyMessage="No reconciliations yet."
    />
  );
}
