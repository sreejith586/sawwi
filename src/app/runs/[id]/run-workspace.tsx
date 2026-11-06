"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { answer, reconcileRun, setFieldColumn, type RunActionResult } from "@/app/actions/runs";
import type { RunView, SlotView } from "@/lib/runs/view";
import type { MappingSource } from "@/lib/runs/types";
import { Report } from "./report";

const STATUS_COPY: Record<RunView["status"], { label: string; tone: string }> = {
  collecting: { label: "Waiting for files", tone: "bg-surface-muted text-muted" },
  clarifying: { label: "A few questions", tone: "bg-warn-soft text-warn" },
  ready: { label: "Ready to reconcile", tone: "bg-info-soft text-info" },
  done: { label: "Reconciled", tone: "bg-success-soft text-success" },
};

export function RunWorkspace({ initial }: { initial: RunView }) {
  const [view, setView] = useState(initial);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Keep the router cache fresh so Back/Forward never shows an older snapshot of the run.
  const update = (next: RunView) => {
    setView(next);
    router.refresh();
  };

  const apply = (result: RunActionResult) => {
    if (result.view) update(result.view);
    setError(result.error);
  };

  const status = STATUS_COPY[view.status];

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{view.templateTitle}</h1>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status.tone}`}>{status.label}</span>
      </div>
      {error && <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      {view.report && (
        <div className="mt-6">
          <Report runId={view.id} report={view.report} />
        </div>
      )}

      {view.report && <h2 className="mt-10 text-lg font-semibold tracking-tight">Inputs</h2>}
      <div className={`${view.report ? "mt-3" : "mt-6"} grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]`}>
        <div className="space-y-4">
          {view.slots.map((slot, i) => (
            <SlotCard
              key={slot.key}
              index={i + 1}
              slot={slot}
              runId={view.id}
              onView={update}
              onError={setError}
              onRemap={(field, column) => startTransition(async () => apply(await setFieldColumn(view.id, slot.key, field, column)))}
              busy={pending}
            />
          ))}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4">
            <button
              type="button"
              disabled={pending || (view.status !== "ready" && view.status !== "done")}
              onClick={() => startTransition(async () => apply(await reconcileRun(view.id)))}
              className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-strong disabled:opacity-40"
            >
              {pending ? "Working…" : view.report ? "Run again" : "Run reconciliation"}
            </button>
            <span className="text-sm text-muted">
              {view.status === "done"
                ? "Change a file or mapping and run again to refresh the report."
                : view.status === "ready"
                  ? "Everything is mapped. Matching takes a few seconds and uses no AI tokens."
                  : "Upload the files and answer the questions first."}
            </span>
          </div>
        </div>

        <Chat view={view} busy={pending} onAnswer={(qid, value) => startTransition(async () => apply(await answer(view.id, qid, value)))} />
      </div>
    </div>
  );
}

// ─── Files ────────────────────────────────────────────────────────────────

function SlotCard(props: {
  index: number;
  slot: SlotView;
  runId: string;
  onView: (v: RunView) => void;
  onError: (e?: string) => void;
  onRemap: (field: string, column: string | null) => void;
  busy: boolean;
}) {
  const { slot } = props;
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setUploading(true);
    props.onError(undefined);
    try {
      const body = new FormData();
      body.set("slot", slot.key);
      body.set("file", file);
      const res = await fetch(`/api/runs/${props.runId}/files`, { method: "POST", body });
      const json = (await res.json()) as { view?: RunView; error?: string };
      if (json.view) props.onView(json.view);
      if (json.error) props.onError(json.error);
    } catch {
      props.onError("Upload failed. Check your connection and try again.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const mapped = slot.file?.fields.filter((f) => f.column).length ?? 0;
  const missingRequired = slot.file?.fields.filter((f) => f.required && !f.column).length ?? 0;

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-strong">
          {props.index}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-medium">
            {slot.label}
            {slot.optional && <span className="ml-2 text-xs font-normal text-muted">Optional</span>}
          </h2>
          <p className="mt-0.5 text-sm text-muted">{slot.description}</p>
        </div>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) void upload(file);
        }}
        className={
          "mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-5 text-center text-sm transition " +
          (dragging ? "border-foreground/50 bg-surface-muted" : "border-border hover:border-foreground/30 hover:bg-surface-muted")
        }
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx"
          className="sr-only"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        {uploading ? (
          <span className="text-muted">Reading your file…</span>
        ) : slot.file ? (
          <>
            <span className="font-medium">{slot.file.name}</span>
            <span className="text-xs text-muted">
              {slot.file.rowCount.toLocaleString()} rows · Drop a different file to replace it
            </span>
          </>
        ) : (
          <>
            <span className="font-medium">Choose a file or drop it here</span>
            <span className="mt-0.5 text-xs text-muted">CSV or Excel · e.g. {slot.examples.slice(0, 2).join(", ")}</span>
          </>
        )}
      </label>

      {slot.file && (
        <details className="mt-4 group" open={missingRequired > 0}>
          <summary className="flex cursor-pointer items-center gap-2 text-sm">
            <span className="font-medium">Column mapping</span>
            <span className="text-muted">
              {mapped} of {slot.file.fields.length} fields
            </span>
            {slot.file.remembered && (
              <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">Remembered</span>
            )}
            {missingRequired > 0 && (
              <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">{missingRequired} required missing</span>
            )}
          </summary>
          <table className="mt-3 w-full text-sm">
            <tbody className="divide-y divide-border">
              {slot.file.fields.map((f) => (
                <tr key={f.key}>
                  <td className="py-2 pr-3 align-middle">
                    {f.label}
                    {f.required && <span className="ml-0.5 text-danger" title="Required">*</span>}
                  </td>
                  <td className="py-2 pr-3">
                    <select
                      value={f.column ?? ""}
                      disabled={props.busy}
                      onChange={(e) => props.onRemap(f.key, e.target.value || null)}
                      className="w-full max-w-64 rounded-md border border-border bg-surface px-2 py-1 text-sm"
                      aria-label={`Column for ${f.label}`}
                    >
                      <option value="">Not in this file</option>
                      {slot.file!.columns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="w-24 py-2 text-right">
                    <SourceBadge source={f.column ? f.source : null} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

const SOURCE_LABELS: Record<MappingSource, string> = {
  remembered: "Remembered",
  auto: "Auto",
  ai: "AI",
  user: "You",
};

function SourceBadge({ source }: { source: MappingSource | null }) {
  if (!source) return null;
  return <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-xs text-muted">{SOURCE_LABELS[source]}</span>;
}

// ─── Chat ─────────────────────────────────────────────────────────────────

function Chat({ view, busy, onAnswer }: { view: RunView; busy: boolean; onAnswer: (questionId: string, value: string) => void }) {
  const endRef = useRef<HTMLDivElement>(null);
  const current = view.openQuestions[0];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [view.messages.length, current?.id]);

  return (
    <aside className="flex max-h-[calc(100vh-8rem)] flex-col rounded-xl border border-border bg-surface lg:sticky lg:top-6">
      <div className="border-b border-border px-4 py-3 text-sm font-medium">Sawwi</div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        <Bubble role="sawwi">Upload each file on the left. I&apos;ll read them, match the columns, and only ask when something is unclear.</Bubble>
        {view.messages.map((m) => (
          <Bubble key={m.id} role={m.role}>
            {m.body}
          </Bubble>
        ))}
        {current && (
          <div className="space-y-2">
            <Bubble role="sawwi">{current.prompt}</Bubble>
            <div className="flex flex-wrap gap-2 pl-1">
              {current.options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  disabled={busy}
                  onClick={() => onAnswer(current.id, o.value)}
                  className="rounded-full border border-border bg-surface px-3 py-1 text-sm font-medium hover:border-foreground/40 hover:bg-surface-muted disabled:opacity-50"
                >
                  {o.label}
                </button>
              ))}
            </div>
            {view.openQuestions.length > 1 && (
              <p className="pl-1 text-xs text-muted">{view.openQuestions.length - 1} more after this</p>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>
      {view.usage.calls > 0 && (
        <div className="border-t border-border px-4 py-2 text-xs text-muted">
          AI calls: {view.usage.calls} · tokens in {view.usage.inputTokens.toLocaleString()} (cached{" "}
          {view.usage.cacheReadTokens.toLocaleString()}) · out {view.usage.outputTokens.toLocaleString()}
        </div>
      )}
    </aside>
  );
}

function Bubble({ role, children }: { role: "sawwi" | "user"; children: React.ReactNode }) {
  return (
    <div className={role === "user" ? "flex justify-end" : "flex"}>
      <p
        className={
          "max-w-[90%] rounded-2xl px-3.5 py-2 leading-relaxed " +
          (role === "user" ? "bg-accent text-accent-foreground" : "bg-surface-muted")
        }
      >
        {children}
      </p>
    </div>
  );
}
