"use client";

import { QueryTable, type QueryColumn } from "@/components/query-table";
import { USER_SEARCH, type UserRow } from "@/lib/saas/admin-rows";

const when = (iso: string) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "–");

const columns: QueryColumn<UserRow>[] = [
  {
    key: "name",
    header: "User",
    render: (r) => (
      <div className="min-w-0">
        <p className="truncate font-medium">{r.name}</p>
        <p className="truncate text-xs text-muted">{r.email}</p>
      </div>
    ),
  },
  { key: "workspaces", header: "Workspaces" },
  { key: "access", header: "Access", cellClass: () => "capitalize text-muted" },
  { key: "created", header: "Signed up", render: (r) => <span className="whitespace-nowrap text-muted">{when(r.created)}</span> },
  { key: "lastLogin", header: "Last login", render: (r) => <span className="whitespace-nowrap text-muted">{when(r.lastLogin)}</span> },
];

export function UsersTable({ rows }: { rows: UserRow[] }) {
  return (
    <QueryTable
      rows={rows}
      columns={columns}
      searchFields={[...USER_SEARCH]}
      searchPlaceholder="Search users"
      initialSort={{ sort: "created", dir: "desc" }}
      exportHref={(params) => `/api/admin/users${params ? `?${params}` : ""}`}
      emptyMessage="No users yet."
    />
  );
}
