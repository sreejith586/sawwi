"use client";

import { useActionState, useTransition } from "react";
import { changeAccess, invite, remove, setActive, type InviteState } from "@/app/actions/accounts";
import { Pill } from "@/components/data-table";
import { QueryTable, type QueryColumn } from "@/components/query-table";
import { buttonClass } from "@/components/ui";
import { ACCESS } from "@/lib/accounts/access";
import { MEMBER_SEARCH, type MemberRow } from "@/lib/accounts/rows";

const STATUS_TONE = { active: "ok", invited: "info", deactivated: "neutral" } as const;
const field =
  "h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none transition-colors placeholder:text-muted focus:border-foreground/40";

export function MembersPanel({ rows, teams }: { rows: MemberRow[]; teams: { value: string; label: string }[] }) {
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<void>) => startTransition(fn);

  const columns: QueryColumn<MemberRow>[] = [
    {
      key: "name",
      header: "Member",
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-surface-muted text-[11px] font-semibold text-muted">
            {r.owner ? "★" : r.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{r.name}</p>
            <p className="truncate text-xs text-muted">{r.owner ? "Signed in on this browser" : r.email}</p>
          </div>
        </div>
      ),
    },
    { key: "team", header: "Team", cellClass: () => "text-muted" },
    {
      key: "access",
      header: "Access",
      render: (r) =>
        r.owner ? (
          <span className="font-medium">Owner</span>
        ) : (
          <select
            aria-label={`Access for ${r.name}`}
            value={r.accessKey}
            disabled={pending || r.statusKey === "deactivated"}
            onChange={(e) => run(() => changeAccess(r.id, e.target.value))}
            className="h-8 rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-foreground/40 disabled:opacity-50"
          >
            {ACCESS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        ),
    },
    { key: "status", header: "Status", render: (r) => <Pill tone={STATUS_TONE[r.statusKey as keyof typeof STATUS_TONE]}>{r.status}</Pill> },
    { key: "invited", header: "Invited", render: (r) => <span className="whitespace-nowrap text-muted">{r.invitedLabel || "–"}</span> },
    {
      key: "id",
      header: "",
      sortable: false,
      align: "right",
      render: (r) =>
        r.owner ? null : (
          <div className="flex justify-end gap-1">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => setActive(r.id, r.statusKey === "deactivated"))}
              className="h-8 rounded-md px-2 text-sm text-muted hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
            >
              {r.statusKey === "deactivated" ? "Reactivate" : "Deactivate"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => window.confirm(`Remove ${r.name} from the team?`) && run(() => remove(r.id))}
              className="h-8 rounded-md px-2 text-sm text-danger hover:bg-danger-soft disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-8">
      <InviteForm teams={teams} />
      <section>
        <h2 className="text-sm font-semibold">Team · {rows.length}</h2>
        <div className="mt-3">
          <QueryTable
            rows={rows}
            columns={columns}
            searchFields={[...MEMBER_SEARCH]}
            searchPlaceholder="Search people"
            filters={[
              { key: "access", label: "Access", allLabel: "All access" },
              { key: "status", label: "Status", allLabel: "All statuses" },
            ]}
            exportHref={(params) => `/api/members${params ? `?${params}` : ""}`}
          />
        </div>
      </section>
      <section className="grid gap-3 sm:grid-cols-3">
        {ACCESS.map((a) => (
          <div key={a.value} className="rounded-xl border border-border bg-surface p-4">
            <p className="text-sm font-medium">{a.label}</p>
            <p className="mt-1 text-sm text-muted">{a.hint}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

function InviteForm({ teams }: { teams: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(invite, { errors: {} });
  const v = state.values;

  return (
    <form
      // Remount with the returned values: React's post-submit reset doesn't restore <select> defaults.
      key={v ? JSON.stringify(v) : "blank"}
      id="invite-form"
      action={action} className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold">Invite a teammate</h2>
      <p className="mt-0.5 text-sm text-muted">They&apos;ll get access to this workspace&apos;s templates and reconciliations.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.3fr_0.9fr_1fr_auto] lg:items-start">
        <label className="block">
          <span className="sr-only">Name</span>
          <input name="name" defaultValue={v?.name} placeholder="Name" className={field} aria-invalid={Boolean(state.errors.name)} />
          {state.errors.name && <span className="mt-1 block text-xs text-danger">{state.errors.name}</span>}
        </label>
        <label className="block">
          <span className="sr-only">Email</span>
          <input name="email" type="email" defaultValue={v?.email} placeholder="name@company.com" className={field} aria-invalid={Boolean(state.errors.email)} />
          {state.errors.email && <span className="mt-1 block text-xs text-danger">{state.errors.email}</span>}
        </label>
        <label className="block">
          <span className="sr-only">Access</span>
          <select name="access" defaultValue={v?.access || "editor"} className={field}>
            {ACCESS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="sr-only">Team</span>
          <select name="team" defaultValue={v?.team ?? ""} className={field}>
            <option value="">Team (optional)</option>
            {teams.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "Inviting…" : "Invite"}
        </button>
      </div>
      <p aria-live="polite" className="mt-3 text-xs text-muted">
        {state.invited ? (
          <span className="text-success">Added {state.invited} to the team.</span>
        ) : (
          "Invites are saved to the team list. Email invitations and sign-in arrive with user accounts."
        )}
      </p>
    </form>
  );
}
