"use client";

import { useEffect, useState } from "react";

// Progress for a bulk upload of supplier invoices (D-93): a bar, how long it has taken, about how
// long is left, and each file's state. Reading takes from seconds (a text PDF) to a minute or two
// (a long scan read by OCR and AI), so the estimate learns from the files already read.

export type UploadItem = {
  name: string;
  state: "waiting" | "reading" | "done" | "failed";
  startedAt?: number;
  ms?: number;
  note?: string;
};

/** Seconds per invoice assumed until the first one is read: a one-page scan read by OCR and AI. */
export const FIRST_GUESS_MS = 45_000;

/**
 * Milliseconds left: the average time of the invoices already read, for those waiting and for
 * what's left of those being read, shared across the parallel readers. Null when nothing is left.
 */
export function estimateRemaining(items: UploadItem[], parallel: number, now: number): number | null {
  const finished = items.filter((i) => i.ms !== undefined);
  const avg = finished.length ? finished.reduce((s, i) => s + i.ms!, 0) / finished.length : FIRST_GUESS_MS;
  const waiting = items.filter((i) => i.state === "waiting").length;
  const reading = items.filter((i) => i.state === "reading");
  if (!waiting && !reading.length) return null;
  // A file taking longer than average still needs a little more, not a negative amount.
  const left = waiting * avg + reading.reduce((s, i) => s + Math.max(avg - (now - (i.startedAt ?? now)), 5_000), 0);
  return left / Math.max(1, Math.min(parallel, waiting + reading.length));
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};
const about = (ms: number) => (ms < 60_000 ? "less than a minute" : `about ${Math.round(ms / 60_000)} min`);

export function UploadProgress({ items, startedAt, parallel }: { items: UploadItem[]; startedAt: number; parallel: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const done = items.filter((i) => i.state === "done" || i.state === "failed").length;
  const failed = items.filter((i) => i.state === "failed").length;
  const left = estimateRemaining(items, parallel, now);
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  const [open, setOpen] = useState(items.length <= 5);

  return (
    <div className="mt-3 rounded-xl border border-border bg-surface p-4 text-sm" role="status" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">
          {done} of {items.length} invoice{items.length === 1 ? "" : "s"} read
          {failed ? <span className="text-danger"> · {failed} couldn&apos;t be read</span> : null}
        </p>
        <p className="text-xs text-muted">
          {clock(now - startedAt)} so far{left !== null ? ` · ${about(left)} left` : ""}
        </p>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        aria-label="Invoices read"
        aria-valuemin={0}
        aria-valuemax={items.length}
        aria-valuenow={done}
      >
        <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted">
        Scans read by OCR and AI take up to a minute or two each; {parallel} are read at a time. Keep this page open until it finishes.
      </p>
      <button type="button" className="mt-2 text-xs text-muted underline hover:text-foreground" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Hide files" : "Show files"}
      </button>
      {open && (
        <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs">
          {items.map((i) => (
            <li key={i.name} className="flex items-center justify-between gap-3">
              <span className="truncate">{i.name}</span>
              <span
                className={`shrink-0 tabular-nums ${i.state === "done" ? "text-success" : i.state === "failed" ? "text-danger" : i.state === "reading" ? "text-foreground" : "text-muted"}`}
                title={i.note}
              >
                {i.state === "waiting"
                  ? "Waiting"
                  : i.state === "reading"
                    ? `Reading… ${clock(now - (i.startedAt ?? now))}`
                    : i.state === "done"
                      ? `✓ ${clock(i.ms ?? 0)}`
                      : "✕ Couldn't read"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
