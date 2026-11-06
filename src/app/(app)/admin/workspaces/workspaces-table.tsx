"use client";

import { useTransition } from "react";
import { extendOrgTrial, setOrgPlan, setOrgSuspended } from "@/app/actions/admin";
import { Pill } from "@/components/data-table";
import { QueryTable, type QueryColumn } from "@/components/query-table";
import { ORG_SEARCH, type OrgRow } from "@/lib/saas/admin-rows";
import { PLANS } from "@/lib/saas/plans";

const short = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

export function WorkspacesTable({ rows }: { rows: OrgRow[] }) {
  const [pending, start] = useTransition();

  const columns: QueryColumn<OrgRow>[] = [
    {
      key: "name",
      header: "Workspace",
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.name}</p>
          <p className="truncate text-xs text-muted">{r.owner || "No owner"}</p>
        </div>
      ),
    },
    {
      key: "plan",
      header: "Plan",
      render: (r) => (
        <select
          aria-label={`Plan for ${r.name}`}
          value={r.planId}
          disabled={pending}
          onChange={(e) => start(() => setOrgPlan(r.id, e.target.value))}
          className="h-8 rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-foreground/40"
        >
          {PLANS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: "trialEnds",
      header: "Trial ends",
      render: (r) =>
        r.planId !== "trial" ? (
          <span className="text-muted">–</span>
        ) : (
          <span className={`whitespace-nowrap ${r.trialState === "Ended" ? "text-danger" : ""}`}>{r.trialEndsLabel}</span>
        ),
    },
    { key: "billing", header: "Billing", render: (r) => (r.billing ? <span className="whitespace-nowrap">{r.billing}</span> : <span className="text-muted">–</span>) },
    { key: "request", header: "Requested", render: (r) => (r.request ? <Pill tone="info">{r.request}</Pill> : <span className="text-muted">–</span>) },
    { key: "users", header: "Users", align: "right" },
    { key: "runsThisMonth", header: "Runs (month)", align: "right" },
    { key: "runs", header: "Runs (all)", align: "right" },
    { key: "status", header: "Status", render: (r) => <Pill tone={r.status === "Suspended" ? "high" : "ok"}>{r.status}</Pill> },
    { key: "created", header: "Created", render: (r) => <span className="whitespace-nowrap text-muted">{short(r.created)}</span> },
    {
      key: "id",
      header: "",
      sortable: false,
      align: "right",
      render: (r) => (
        <div className="flex justify-end gap-1">
          {r.planId === "trial" && (
            <button type="button" disabled={pending} onClick={() => start(() => extendOrgTrial(r.id, 14))} className="h-8 whitespace-nowrap rounded-md px-2 text-sm text-muted hover:bg-surface-muted hover:text-foreground">
              +14 days
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const suspend = r.status !== "Suspended";
              if (suspend && !window.confirm(`Suspend ${r.name}? Its team can still log in but can't start reconciliations.`)) return;
              start(() => setOrgSuspended(r.id, suspend));
            }}
            className={`h-8 rounded-md px-2 text-sm ${r.status === "Suspended" ? "text-muted hover:bg-surface-muted hover:text-foreground" : "text-danger hover:bg-danger-soft"}`}
          >
            {r.status === "Suspended" ? "Reactivate" : "Suspend"}
          </button>
        </div>
      ),
    },
  ];

  return (
    <QueryTable
      rows={rows}
      columns={columns}
      searchFields={[...ORG_SEARCH]}
      searchPlaceholder="Search workspaces or owners"
      filters={[
        { key: "plan", label: "Plan", allLabel: "All plans" },
        { key: "trialState", label: "Trial", allLabel: "Any trial state" },
        { key: "billing", label: "Billing", allLabel: "Any billing" },
        { key: "status", label: "Status", allLabel: "All statuses" },
      ]}
      initialSort={{ sort: "created", dir: "desc" }}
      exportHref={(params) => `/api/admin/workspaces${params ? `?${params}` : ""}`}
      emptyMessage="No workspaces yet."
    />
  );
}
