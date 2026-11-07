"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui";
import { slotFit } from "@/lib/connectors/slot-fit";
import type { ImportSource } from "@/lib/connectors/sources";
import type { RunView } from "@/lib/runs/view";

const input = "h-8 rounded-md border border-border bg-surface px-2 text-sm text-foreground outline-none focus:border-foreground/40";

/** Last full calendar month, UTC: the usual reconciliation period. */
function lastMonth(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/** Pulls a report from a connected source into this slot, as if it had been uploaded (D-28). */
export function ImportFromConnection(props: {
  runId: string;
  templateId: string;
  slotKey: string;
  sources: ImportSource[];
  onView: (v: RunView) => void;
  onError: (e?: string) => void;
}) {
  // Reports made for this template's slot first, then ones for any slot of that name; any
  // report can still go into any slot.
  const options = props.sources.flatMap((s) =>
    s.reports.map((r) => ({ value: `${s.connectionId}:${r.id}`, label: `${s.label} · ${r.label}`, fits: slotFit(r.slots, props.templateId, props.slotKey) })),
  );
  options.sort((a, b) => b.fits - a.fits);
  const [choice, setChoice] = useState(options[0]?.value ?? "");
  const [period, setPeriod] = useState(lastMonth);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string>();
  if (options.length === 0) return null;

  const pull = async () => {
    const [connectionId, report] = choice.split(":");
    setBusy(true);
    setDone(undefined);
    props.onError(undefined);
    try {
      const res = await fetch(`/api/runs/${props.runId}/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot: props.slotKey, connectionId, report, ...period }),
      });
      const json = (await res.json()) as { view?: RunView; error?: string; rows?: number };
      if (json.view) props.onView(json.view);
      if (json.error) props.onError(json.error);
      if (json.rows) setDone(`${json.rows.toLocaleString()} rows imported`);
    } catch {
      props.onError("The import didn't finish. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="mt-3 rounded-lg border border-border px-3 py-2 text-sm">
      <summary className="cursor-pointer text-muted hover:text-foreground">Import from a connection</summary>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select aria-label="Source" value={choice} onChange={(e) => setChoice(e.target.value)} className={`${input} max-w-72`}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-muted">
          From
          <input type="date" value={period.from} onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))} className={input} />
        </label>
        <label className="flex items-center gap-1 text-muted">
          to
          <input type="date" value={period.to} onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))} className={input} />
        </label>
        <button type="button" disabled={busy || !choice} onClick={() => void pull()} className={`${buttonClass("secondary")} h-8`}>
          {busy ? "Importing…" : "Import"}
        </button>
        {done && <span className="text-success">{done}</span>}
      </div>
      <p className="mt-2 text-xs text-muted">Dates are in UTC. Importing replaces this slot&apos;s file, like uploading a new one.</p>
    </details>
  );
}
