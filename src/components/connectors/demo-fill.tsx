"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui";
import type { RunView } from "@/lib/runs/view";

/** The demo store only (D-31, D-32): one click fills every empty slot from its built-in sources. */
export function DemoFill(props: { runId: string; onView: (v: RunView) => void; onError: (e?: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();

  const fill = async () => {
    setBusy(true);
    setNote(undefined);
    props.onError(undefined);
    try {
      const res = await fetch(`/api/runs/${props.runId}/demo-fill`, { method: "POST" });
      const json = (await res.json()) as { view?: RunView; error?: string; filled?: { slot: string; rows: number }[]; missing?: string[] };
      if (json.view) props.onView(json.view);
      if (json.error) props.onError(json.error);
      if (json.filled) {
        const parts = [`Imported ${json.filled.length} file${json.filled.length === 1 ? "" : "s"} (${json.filled.map((f) => `${f.slot}: ${f.rows} rows`).join("; ")}).`];
        if (json.missing?.length) parts.push(`No demo data for: ${json.missing.join(", ")}. Upload those yourself.`);
        setNote(parts.join(" "));
      }
    } catch {
      props.onError("The demo import didn't finish. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border bg-surface px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-medium">Live demo</p>
        <p className="text-muted">Fill every empty file with invented October 2026 data (a marketplace seller, a Magento store, a Business Central company, and their gateway, courier, warehouse and bank files), then run the reconciliation.</p>
        {note && (
          <p role="status" className="mt-1 text-success">
            {note}
          </p>
        )}
      </div>
      <button type="button" disabled={busy} onClick={() => void fill()} className={buttonClass("secondary")}>
        {busy ? "Importing…" : "Fill with demo data"}
      </button>
    </div>
  );
}
