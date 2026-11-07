"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { addConnectionAction, removeConnectionAction, type ConnectionActionState } from "@/app/actions/connections";
import { Pill } from "@/components/data-table";
import { QueryTable, type QueryColumn } from "@/components/query-table";
import { buttonClass } from "@/components/ui";
import { SYNC_SEARCH } from "@/lib/connectors/columns";
import type { SyncRow } from "@/lib/connectors/rows";
import type { CredentialField } from "@/lib/connectors/types";

const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const field = "h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-foreground/40";

export type ConnectorOption = { id: string; label: string; description: string; fields: CredentialField[] };
export type ConnectionItem = { id: string; provider: string; accountLabel: string; status: string; lastError: string | null; lastSyncAt: string | null; createdAt: string };

export function AddConnection({ connectors }: { connectors: ConnectorOption[] }) {
  const [provider, setProvider] = useState(connectors[0]?.id ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [state, action, pending] = useActionState<ConnectionActionState, FormData>(async (prev, form) => {
    const result = await addConnectionAction(prev, form);
    if (result.added) setValues({}); // keep the source, clear what was typed
    return result;
  }, {});
  const [, startSubmit] = useTransition();
  const c = connectors.find((x) => x.id === provider);
  return (
    // Submitted by hand rather than with `action=`, so React doesn't reset the fields (and the
    // source picker) behind our state after each attempt.
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        startSubmit(() => action(form));
      }}
      autoComplete="off"
      className="space-y-4 rounded-xl border border-border bg-surface p-5"
    >
      <label className="block text-sm">
        <span className="font-medium">Source</span>
        <select
          name="provider"
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            setValues({});
          }}
          className={`${field} mt-1.5`}
        >
          {connectors.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
        {c && <span className="mt-1 block text-xs text-muted">{c.description}</span>}
      </label>
      {c?.fields.map((f) => (
        <label key={`${provider}-${f.key}`} className="block text-sm">
          <span className="font-medium">
            {f.label}
            {f.optional && <span className="font-normal text-muted"> (optional)</span>}
          </span>
          <input
            name={f.key}
            type={f.secret ? "password" : "text"}
            placeholder={f.placeholder}
            required={!f.optional}
            value={values[f.key] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            autoComplete="off"
            spellCheck={false}
            className={`${field} mt-1.5`}
          />
          {f.help && <span className="mt-1 block text-xs text-muted">{f.help}</span>}
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || !c} className={buttonClass("primary")}>
          {pending ? "Checking…" : "Test and connect"}
        </button>
        <span className="text-xs text-muted">Sawwi checks the credentials with a read-only call, then stores them encrypted. Secrets are never shown again.</span>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.added && (
        <p role="status" className="text-sm text-success">
          Connected to {state.added}.
        </p>
      )}
    </form>
  );
}

export function ConnectionList({ items, canManage, labels = {} }: { items: ConnectionItem[]; canManage: boolean; labels?: Record<string, string> }) {
  const [pending, start] = useTransition();
  if (items.length === 0) return <p className="text-sm text-muted">No connections yet.</p>;
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
      {items.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{c.accountLabel}</p>
            <p className="text-xs text-muted">
              {labels[c.provider] ?? c.provider} · connected {when(c.createdAt)}
              {c.lastSyncAt ? ` · last import ${when(c.lastSyncAt)}` : " · not used yet"}
            </p>
            {c.lastError && <p className="mt-1 text-xs text-danger">{c.lastError}</p>}
          </div>
          <Pill tone={c.status === "connected" ? "ok" : "high"}>{c.status === "connected" ? "Connected" : "Needs attention"}</Pill>
          {canManage && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (confirm("Remove this connection? Sawwi deletes its stored credentials. Files already imported stay in their runs.")) start(() => removeConnectionAction(c.id));
              }}
              className="text-sm text-muted hover:text-danger disabled:opacity-40"
            >
              Remove
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

const syncColumns: QueryColumn<SyncRow>[] = [
  { key: "at", header: "When", render: (r) => <span className="whitespace-nowrap text-muted">{when(r.at)}</span> },
  { key: "connection", header: "Connection" },
  { key: "report", header: "Report" },
  { key: "from", header: "Period", render: (r) => <span className="whitespace-nowrap">{r.from} → {r.to}</span> },
  { key: "rows", header: "Rows", align: "right", render: (r) => r.rows.toLocaleString("en-US") },
  {
    key: "status",
    header: "Status",
    render: (r) => (
      <span title={r.error || undefined}>
        <Pill tone={r.status === "Imported" ? "ok" : "high"}>{r.status}</Pill>
      </span>
    ),
  },
  {
    key: "runId",
    header: "Run",
    sortable: false,
    render: (r) =>
      r.runId ? (
        <Link href={`/runs/${r.runId}`} className="text-muted hover:text-foreground hover:underline">
          Open
        </Link>
      ) : (
        ""
      ),
  },
];

export function SyncHistory({ rows }: { rows: SyncRow[] }) {
  return (
    <QueryTable
      rows={rows}
      columns={syncColumns}
      searchFields={[...SYNC_SEARCH]}
      searchPlaceholder="Search imports"
      filters={[
        { key: "status", label: "Status", allLabel: "All statuses" },
        { key: "connection", label: "Connection", allLabel: "All connections" },
      ]}
      initialSort={{ sort: "at", dir: "desc" }}
      exportHref={(params) => `/api/connections/syncs${params ? `?${params}` : ""}`}
      emptyMessage="Nothing imported yet. On a reconciliation, open a file slot and choose “Import from a connection”."
      dense
    />
  );
}
