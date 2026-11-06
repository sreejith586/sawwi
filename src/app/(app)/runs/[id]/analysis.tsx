"use client";

import { useEffect, useState } from "react";
import { getNarrative } from "@/app/actions/insights";
import type { NarrativeView } from "@/lib/insights/chat";

// The plain-language analysis at the top of a report. It's fetched after the report renders,
// so matching results show at once; the first open writes it (Sonnet), later opens read the
// cached copy for free. Without an API key it is Sawwi's own rule-based summary.

export function Analysis({ runId, ranAt, clean }: { runId: string; ranAt: string; clean: boolean }) {
  const [state, setState] = useState<{ key: string; data?: NarrativeView; failed?: boolean }>({ key: "" });
  const key = `${runId}:${ranAt}`;

  useEffect(() => {
    let cancelled = false;
    getNarrative(runId)
      .then((data) => !cancelled && setState({ key, data, failed: !data }))
      .catch(() => !cancelled && setState({ key, failed: true }));
    return () => {
      cancelled = true;
    };
  }, [runId, key]);

  const current = state.key === key ? state : undefined;
  const data = current?.data;

  return (
    <section
      aria-labelledby="analysis-title"
      className={`rounded-xl border p-5 ${clean ? "border-success/30 bg-success-soft/40" : "border-border bg-surface"}`}
    >
      <div className="flex items-center gap-2">
        <h3 id="analysis-title" className="text-xs font-semibold uppercase tracking-wide text-muted">
          Analysis
        </h3>
        {data && (
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-muted">{data.source === "ai" ? "Written by AI from the totals" : "Summary by Sawwi"}</span>
        )}
      </div>

      {!current ? (
        <div className="mt-3 space-y-2" aria-busy="true" aria-label="Writing the analysis">
          <div className="h-5 w-3/4 animate-pulse rounded bg-surface-muted" />
          <div className="h-4 w-full animate-pulse rounded bg-surface-muted" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-surface-muted" />
        </div>
      ) : current.failed || !data ? (
        <p className="mt-2 text-sm text-muted">The analysis isn&apos;t available right now. The tables below have every number.</p>
      ) : (
        <>
          <p className="mt-2 text-base font-medium leading-relaxed">{data.narrative.headline}</p>
          {(data.narrative.findings.length > 0 || data.narrative.nextSteps.length > 0) && (
            <div className="mt-4 grid gap-5 md:grid-cols-2">
              {data.narrative.findings.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted">What&apos;s wrong</p>
                  <ul className="mt-2 space-y-2 text-sm">
                    {data.narrative.findings.map((f) => (
                      <li key={f} className="flex gap-2.5">
                        <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-danger" />
                        <span className="leading-relaxed">{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.narrative.nextSteps.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted">What to do first</p>
                  <ol className="mt-2 space-y-2 text-sm">
                    {data.narrative.nextSteps.map((s, i) => (
                      <li key={s} className="flex gap-2.5">
                        <span className="tabular grid size-5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground">{i + 1}</span>
                        <span className="leading-relaxed">{s}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
