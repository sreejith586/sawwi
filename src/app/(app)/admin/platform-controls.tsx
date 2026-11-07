"use client";

import { useState, useTransition } from "react";
import { approveRequest, declineRequest, setPaywall, setSignupsOpen, setTrialDays } from "@/app/actions/admin";
import { buttonClass } from "@/components/ui";

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50 ${checked ? "bg-success" : "bg-border"}`}
    >
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left] ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export function PlatformControls({ paywallEnabled, signupsOpen, trialDays }: { paywallEnabled: boolean; signupsOpen: boolean; trialDays: number }) {
  const [pending, start] = useTransition();
  const [days, setDays] = useState(String(trialDays));
  const run = (fn: () => Promise<void>) => start(fn);

  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-surface">
      <div className="flex items-start justify-between gap-6 p-5">
        <div>
          <p className="font-medium">Paywall</p>
          <p className="mt-1 max-w-xl text-sm text-muted">
            When on, workspaces need an active trial or plan to start reconciliations, and plan limits apply. Existing reports always stay
            readable. Pricing appears on the public page.
          </p>
          <p className={`mt-2 text-xs font-medium ${paywallEnabled ? "text-warn" : "text-muted"}`}>
            {paywallEnabled ? "On: trials and limits are enforced." : "Off: everything is free (early access)."}
          </p>
        </div>
        <Switch
          label="Paywall"
          checked={paywallEnabled}
          disabled={pending}
          onChange={(v) => {
            if (v && !window.confirm("Turn the paywall on? Workspaces with an ended trial will be blocked from starting reconciliations.")) return;
            run(() => setPaywall(v));
          }}
        />
      </div>
      <div className="flex items-start justify-between gap-6 p-5">
        <div>
          <p className="font-medium">Open sign-ups</p>
          <p className="mt-1 text-sm text-muted">When off, only people invited by an existing workspace can create an account.</p>
        </div>
        <Switch label="Open sign-ups" checked={signupsOpen} disabled={pending} onChange={(v) => run(() => setSignupsOpen(v))} />
      </div>
      <form
        className="flex flex-wrap items-end justify-between gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => setTrialDays(Number(days)));
        }}
      >
        <div>
          <label htmlFor="trial-days" className="font-medium">
            Trial length
          </label>
          <p className="mt-1 text-sm text-muted">Days of free trial for new workspaces. Existing trials keep their end date.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="trial-days"
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="h-9 w-20 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-foreground/40"
          />
          <span className="text-sm text-muted">days</span>
          <button type="submit" disabled={pending || Number(days) === trialDays} className={buttonClass("secondary")}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

export type RequestRow = { id: string; org: string; requester: string; plan: string; createdAt: string };

export function UpgradeRequests({ requests }: { requests: RequestRow[] }) {
  const [pending, start] = useTransition();
  if (requests.length === 0) return <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted">No open requests.</p>;
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
      {requests.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {r.org} wants <span className="font-semibold">{r.plan}</span>
            </p>
            <p className="truncate text-xs text-muted">
              {r.requester} · {r.createdAt}
            </p>
          </div>
          <button type="button" disabled={pending} onClick={() => start(() => declineRequest(r.id))} className="h-8 rounded-md px-2.5 text-sm text-muted hover:bg-surface-muted hover:text-foreground">
            Decline
          </button>
          <button type="button" disabled={pending} onClick={() => start(() => approveRequest(r.id))} className={`${buttonClass("primary")} h-8 px-3`}>
            Switch plan
          </button>
        </li>
      ))}
    </ul>
  );
}
