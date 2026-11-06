"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { startGenericRun } from "@/app/actions/insights";
import { buttonClass } from "@/components/ui";
import { DEFAULT_SETUP, GENERIC_PRESETS, TOLERANCE_OPTIONS } from "@/lib/templates/custom";

// "No template fits": name the two files (one click with a preset), pick a tolerance, start.
// Key and amount columns are confirmed with chips once the files are uploaded.

const chip = (on: boolean) =>
  "h-8 rounded-full border px-3 text-sm transition " + (on ? "border-foreground bg-foreground text-background" : "border-border bg-surface text-muted hover:text-foreground");

export function GenericSetup() {
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [tolerance, setTolerance] = useState(String(DEFAULT_SETUP.tolerance));

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border p-5 text-sm">
        <div>
          <p className="font-medium">Don&apos;t see your reconciliation?</p>
          <p className="mt-1 text-muted">Compare any two files on a key column and an amount. Save the setup as your own template when it works.</p>
        </div>
        <button type="button" onClick={() => setOpen(true)} className={buttonClass("secondary")}>
          Start a custom reconciliation
        </button>
      </div>
    );
  }

  return (
    <form action={startGenericRun} className="rounded-xl border border-border bg-surface p-5 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">Custom reconciliation</p>
          <p className="mt-0.5 text-muted">What are you comparing? Pick one or name the files yourself.</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-muted hover:text-foreground" aria-label="Close">
          ✕
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {GENERIC_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              setLeft(p.left);
              setRight(p.right);
            }}
            className={chip(left === p.left && right === p.right)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-muted">First file</span>
          <input name="left" value={left} onChange={(e) => setLeft(e.target.value)} placeholder={DEFAULT_SETUP.leftLabel} maxLength={60} className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-3 outline-none focus:border-foreground/40" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted">Second file</span>
          <input name="right" value={right} onChange={(e) => setRight(e.target.value)} placeholder={DEFAULT_SETUP.rightLabel} maxLength={60} className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-3 outline-none focus:border-foreground/40" />
        </label>
      </div>

      <fieldset className="mt-4">
        <legend className="text-xs font-medium text-muted">Amounts match when they differ by at most</legend>
        <input type="hidden" name="tolerance" value={tolerance} />
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {TOLERANCE_OPTIONS.map((t) => (
            <button key={t.value} type="button" aria-pressed={tolerance === t.value} onClick={() => setTolerance(t.value)} className={chip(tolerance === t.value)}>
              {t.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-5 flex items-center gap-3">
        <Submit />
        <span className="text-xs text-muted">Next: upload both files. I&apos;ll ask which columns are the key and the amount.</span>
      </div>
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("primary")}>
      {pending ? "Starting…" : "Start →"}
    </button>
  );
}
