"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { saveAsTemplate, sendChat } from "@/app/actions/insights";
import { answer, reconcileRun, setFieldColumn, type RunActionResult } from "@/app/actions/runs";
import type { ChatIntent } from "@/lib/insights/chat";
import { DemoFill } from "@/components/connectors/demo-fill";
import { ImportFromConnection } from "@/components/connectors/import-from-connection";
import { Pill } from "@/components/data-table";
import { useChatPanelSlot } from "@/components/shell/chat-panel";
import { QueryTable, type QueryColumn } from "@/components/query-table";
import { buttonClass } from "@/components/ui";
import { setChatAttention, setChatOpen } from "@/lib/chat-panel";
import type { ImportSource } from "@/lib/connectors/sources";
import type { PdfFileInfo } from "@/lib/pdf/types";
import { RUN_STATUS, type StatusTone } from "@/lib/runs/status";
import type { RunView, SlotView } from "@/lib/runs/view";
import { MAPPING_SEARCH, mappingRows, previewFilterKeys, type MappingRow, type PreviewRow } from "@/lib/tables/rows";
import { Chat } from "./chat";
import { Report } from "./report";

export function RunWorkspace({ initial, sources = [], demo = false }: { initial: RunView; sources?: ImportSource[]; demo?: boolean }) {
  const [view, setView] = useState(initial);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [thinking, startChat] = useTransition();
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

  // The run's chat lives in the right-hand panel (components/shell/chat-panel.tsx). Asking
  // something opens it, so the answer is in view.
  const chatSlot = useChatPanelSlot();
  const ask = (intent: ChatIntent) => {
    setChatOpen(true);
    startChat(async () => apply(await sendChat(view.id, intent)));
  };

  // A setup question needs an answer: open the panel on wide screens, and flag the chat button
  // (a dot) whenever the panel is closed. Leaving the run clears the flag.
  const questionId = view.openQuestions[0]?.id;
  useEffect(() => {
    if (questionId && window.matchMedia("(min-width: 64rem)").matches) setChatOpen(true);
    setChatAttention(Boolean(questionId));
  }, [questionId]);
  useEffect(() => () => setChatAttention(false), []);

  const status = RUN_STATUS[view.status];
  const uploaded = view.slots.filter((s) => s.file).length;
  const needed = view.slots.filter((s) => !s.optional && !s.file).length;
  const open = view.openQuestions.length;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{view.templateTitle}</h1>
        <Pill tone={status.tone}>{status.label}</Pill>
      </div>
      <p className="tabular mt-1.5 text-sm text-muted">
        {uploaded} of {view.slots.length} files uploaded
        {needed > 0 && ` · ${needed} more needed`}
        {open > 0 && ` · ${open} question${open === 1 ? "" : "s"} open`}
        {open > 0 && (
          <>
            {" · "}
            <button type="button" onClick={() => setChatOpen(true)} className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
              Answer in the chat
            </button>
          </>
        )}
      </p>
      <Steps status={view.status} />
      {error && <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {demo && view.slots.some((s) => !s.file) && <DemoFill runId={view.id} onView={update} onError={setError} />}

      {view.report && (
        <div className="mt-8">
          <Report runId={view.id} report={view.report} onExplain={(exception) => ask({ kind: "explain", exception })} />
        </div>
      )}

      {view.report && <h2 className="mt-10 text-lg font-semibold tracking-tight">Inputs</h2>}
      <div className={view.report ? "mt-3" : "mt-6"}>
        <div className="min-w-0 space-y-4">
          {view.slots.map((slot, i) => (
            <SlotCard
              key={slot.key}
              index={i + 1}
              slot={slot}
              runId={view.id}
              templateId={view.templateId}
              sources={sources}
              noUploads={demo}
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
              className={buttonClass("primary")}
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
          {view.generic && (view.status === "ready" || view.status === "done") && (
            <SaveTemplate key={view.templateTitle} defaultTitle={view.templateTitle} onSave={(title) => startTransition(async () => apply(await saveAsTemplate(view.id, title)))} busy={pending} saved={view.messages.some((m) => m.body.startsWith("Saved as \""))} />
          )}
        </div>

        {chatSlot &&
          createPortal(
            <Chat
              view={view}
              busy={pending}
              thinking={thinking}
              onIntent={ask}
              onAnswer={(qid, value) => startTransition(async () => apply(await answer(view.id, qid, value)))}
            />,
            chatSlot,
          )}
      </div>
    </div>
  );
}

function Steps({ status }: { status: RunView["status"] }) {
  const current = { collecting: 0, clarifying: 1, ready: 2, done: 3 }[status];
  return (
    <ol className="mt-5 grid grid-cols-3 gap-2" aria-label="Progress">
      {["Upload files", "Answer questions", "Reconcile"].map((label, i) => (
        <li key={label} className="min-w-0">
          <div className={`h-1 rounded-full ${i < current ? "bg-foreground" : i === current ? "bg-foreground/35" : "bg-border"}`} />
          <p className={`mt-2 truncate text-xs ${i <= current ? "font-medium text-foreground" : "text-muted"}`}>
            {i < current ? "✓ " : ""}
            {label}
          </p>
        </li>
      ))}
    </ol>
  );
}

// ─── Files ────────────────────────────────────────────────────────────────

function SlotCard(props: {
  index: number;
  slot: SlotView;
  runId: string;
  templateId: string;
  sources: ImportSource[];
  /** The demo store (D-32): shared by visitors, so files come from its demo sources only. */
  noUploads?: boolean;
  onView: (v: RunView) => void;
  onError: (e?: string) => void;
  onRemap: (field: string, column: string | null) => void;
  busy: boolean;
}) {
  const { slot } = props;
  const [uploading, setUploading] = useState(false);
  // Scanned PDFs are OCR'd on the server, a few seconds a page: say so while it works.
  const [slow, setSlow] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState<"mapping" | "preview">("mapping");
  const inputRef = useRef<HTMLInputElement>(null);

  // Several files at once go into the slot together, e.g. a month of supplier invoice PDFs.
  const upload = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    const hasPdf = files.some((f) => f.name.toLowerCase().endsWith(".pdf"));
    const timer = hasPdf ? setTimeout(() => setSlow(true), 2500) : undefined;
    props.onError(undefined);
    try {
      const body = new FormData();
      body.set("slot", slot.key);
      for (const file of files) body.append("file", file);
      const res = await fetch(`/api/runs/${props.runId}/files`, { method: "POST", body });
      const json = (await res.json()) as { view?: RunView; error?: string };
      if (json.view) props.onView(json.view);
      if (json.error) props.onError(json.error);
    } catch {
      props.onError("Upload failed. Check your connection and try again.");
    } finally {
      clearTimeout(timer);
      setSlow(false);
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const fields = slot.file?.fields ?? [];
  const mapped = fields.filter((f) => f.column).length;
  const missingRequired = fields.filter((f) => f.required && !f.column).length;

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept=".csv,.tsv,.txt,.xlsx,.pdf"
      multiple
      className="sr-only"
      disabled={uploading}
      onChange={(e) => void upload([...(e.target.files ?? [])])}
    />
  );

  return (
    <section
      className={`overflow-hidden rounded-xl border bg-surface transition ${dragging ? "border-foreground/50" : "border-border"}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!props.noUploads) void upload([...e.dataTransfer.files]);
      }}
    >
      <div className="flex items-start gap-3 p-5">
        <span
          className={`tabular grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
            slot.file ? "bg-accent text-accent-foreground" : "border border-border text-muted"
          }`}
        >
          {slot.file ? "✓" : props.index}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">
            {slot.label}
            {slot.optional && <span className="ml-2 text-xs font-normal text-muted">Optional</span>}
          </h2>
          <p className="mt-0.5 text-sm text-muted">{slot.description}</p>

          {slot.file ? (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-muted/50 px-3 py-2.5">
                <FileIcon />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{slot.file.name}</p>
                  <p className="tabular text-xs text-muted">
                    {slot.file.rowCount.toLocaleString()} rows · {slot.file.columns.length} columns
                  </p>
                </div>
                {slot.file.remembered && <Pill tone="ok">Mapping remembered</Pill>}
                {missingRequired > 0 && <Pill tone="high">{missingRequired} required missing</Pill>}
                {!props.noUploads && (
                  <label className="inline-flex h-8 cursor-pointer items-center rounded-md px-2.5 text-xs font-medium text-muted hover:bg-surface-muted hover:text-foreground">
                    {input}
                    {uploading ? (slow ? "Reading scanned pages…" : "Reading…") : "Replace"}
                  </label>
                )}
              </div>
              {slot.file.pdf && <PdfDetails infos={slot.file.pdf} />}
            </>
          ) : props.noUploads ? (
            <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted">
              Uploads are off in the live demo. Use <strong>Fill with demo data</strong> above, or “Import from a connection” below.
            </p>
          ) : (
            <label
              className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-7 text-center transition ${
                dragging ? "border-foreground/50 bg-surface-muted" : "border-border hover:border-foreground/30 hover:bg-surface-muted/60"
              }`}
            >
              {input}
              {uploading ? (
                <span className="text-sm text-muted" role="status">
                  {slow ? "Reading scanned pages… OCR takes a few seconds a page." : "Reading your file…"}
                </span>
              ) : (
                <>
                  <span className="grid size-9 place-items-center rounded-full border border-border bg-surface text-muted shadow-sm">
                    <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M8 11V3m0 0L5 6m3-3 3 3M3 13h10" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="mt-2.5 text-sm font-medium">Drop files or click to browse</span>
                  <span className="mt-0.5 text-xs text-muted">CSV, Excel or PDF · e.g. {slot.examples.slice(0, 2).join(", ")}</span>
                </>
              )}
            </label>
          )}
          <ImportFromConnection runId={props.runId} templateId={props.templateId} slotKey={slot.key} sources={props.sources} onView={props.onView} onError={props.onError} />
        </div>
      </div>

      {slot.file && (
        <div className="border-t border-border bg-surface-muted/30 px-5 pb-5 pt-3">
          <div className="mb-3 flex items-center gap-1 text-sm" role="tablist">
            {(
              [
                ["mapping", `Column mapping · ${mapped}/${fields.length}`],
                ["preview", "Preview data"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`rounded-md px-2.5 py-1.5 font-medium transition ${
                  tab === value ? "bg-surface text-foreground shadow-sm ring-1 ring-border" : "text-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "mapping" ? (
            <MappingTable runId={props.runId} slot={slot} busy={props.busy} onRemap={props.onRemap} />
          ) : (
            <FilePreview runId={props.runId} slotKey={slot.key} fileName={slot.file.name} pdf={slot.file.pdf} />
          )}
        </div>
      )}
    </section>
  );
}

const PDF_KIND: Record<PdfFileInfo["kind"], string> = { statement: "Bank statement", invoice: "Invoice", table: "Table" };
const PDF_METHOD: Record<PdfFileInfo["method"], string> = {
  zatca_xml: "ZATCA e-invoice XML",
  zatca_qr: "ZATCA QR code",
  text: "text layer",
  ocr: "scanned pages (OCR)",
};

/** How a PDF was read: what it is, its header facts (kept out of the rows) and the checks run before matching. */
function PdfDetails({ infos }: { infos: PdfFileInfo[] }) {
  if (infos.length > 1) {
    const failed = infos.filter((i) => i.checks.some((c) => !c.ok));
    const kinds = [...new Set(infos.map((i) => PDF_KIND[i.kind].toLowerCase()))].join(", ");
    return (
      <div className="mt-3 rounded-lg border border-border px-3 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="info">{infos.length} PDFs</Pill>
          <span className="text-muted">
            {kinds} · read from {[...new Set(infos.map((i) => PDF_METHOD[i.method]))].join(" / ")}
          </span>
          {failed.length === 0 ? <Pill tone="ok">All checks pass</Pill> : <Pill tone="high">{failed.length} need a look</Pill>}
          {infos.some((i) => i.ocr) && <Pill tone="medium">{infos.filter((i) => i.ocr).length} read by OCR · review rows</Pill>}
        </div>
        {failed.length > 0 && (
          <ul className="mt-2 space-y-1">
            {failed.map((f) => (
              <li key={f.fileName}>
                <span className="font-medium">{f.fileName}</span>
                <span className="text-muted"> · {f.checks.filter((c) => !c.ok).map((c) => c.detail).join(" ")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  const info = infos[0];
  return (
    <div className="mt-3 rounded-lg border border-border px-3 py-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="info">PDF · {PDF_KIND[info.kind]}</Pill>
        <span className="tabular text-muted">
          {info.pages} page{info.pages === 1 ? "" : "s"} · read from its {PDF_METHOD[info.method]}
          {info.skipped > 0 && ` · ${info.skipped} non-transaction line${info.skipped === 1 ? "" : "s"} set aside`}
        </span>
        {info.layout === "remembered" && <Pill tone="ok">PDF layout remembered</Pill>}
        {info.ocr && <Pill tone="medium">OCR · {info.ocr.confidence}% confidence · review rows</Pill>}
      </div>
      {info.meta.length > 0 && (
        <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          {info.meta.map((m) => (
            <div key={m.label} className="min-w-0">
              <dt className="text-muted">{m.label}</dt>
              <dd className="tabular truncate font-medium" title={m.value}>
                {m.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {info.checks.length > 0 && (
        <ul className="mt-2.5 space-y-1 border-t border-border pt-2">
          {info.checks.map((c) => (
            <li key={c.id} className="flex gap-2">
              <span aria-hidden className={c.ok ? "text-success" : "text-danger"}>
                {c.ok ? "✓" : "✕"}
              </span>
              <span>
                <span className={c.ok ? "font-medium" : "font-medium text-danger"}>{c.label}</span>
                <span className="text-muted"> · {c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FileIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M4 1.5h5.5L12.5 4.5v10h-8.5z M9.5 1.5v3h3 M6 8h4.5 M6 10.5h4.5" strokeLinejoin="round" />
    </svg>
  );
}

const STATUS_TONE: Record<MappingRow["status"], StatusTone | "high"> = { Mapped: "ok", Missing: "high", "Not in file": "neutral" };

function MappingTable({ runId, slot, busy, onRemap }: { runId: string; slot: SlotView; busy: boolean; onRemap: (field: string, column: string | null) => void }) {
  const file = slot.file!;
  const columns: QueryColumn<MappingRow>[] = [
    {
      key: "field",
      header: "Sawwi field",
      render: (r) => (
        <span className="font-medium">
          {r.field}
          {r.required === "Required" && <span className="ml-1 text-xs font-normal text-muted">required</span>}
        </span>
      ),
    },
    {
      key: "column",
      header: "Your column",
      sortable: false,
      render: (r) => (
        <select
          value={r.column}
          disabled={busy}
          onChange={(e) => onRemap(r.id, e.target.value || null)}
          aria-label={`Column for ${r.field}`}
          className={`h-8 w-full max-w-60 rounded-md border bg-surface px-2 text-sm outline-none focus:border-foreground/40 ${
            r.status === "Missing" ? "border-danger/40 text-danger" : "border-border"
          }`}
        >
          <option value="">Not in this file</option>
          {file.columns.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      ),
    },
    { key: "status", header: "Status", render: (r) => <Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill> },
    { key: "source", header: "Matched by", render: (r) => <span className="text-xs text-muted">{r.source}</span> },
  ];
  return (
    <QueryTable
      rows={mappingRows(slot)}
      columns={columns}
      searchFields={[...MAPPING_SEARCH]}
      searchPlaceholder="Search fields"
      filters={[
        { key: "status", label: "Status", allLabel: "All statuses" },
        { key: "source", label: "Matched by", allLabel: "Any match" },
      ]}
      exportHref={(params) => `/api/runs/${runId}/mapping?slot=${slot.key}${params ? `&${params}` : ""}`}
      pageSize={50}
      dense
    />
  );
}

type Preview = { headers: string[]; kinds: string[]; rows: PreviewRow[]; total: number };

const fmt = (v: unknown, decimals: boolean) =>
  typeof v === "number" ? v.toLocaleString("en-US", { minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: 2 }) : String(v ?? "");

function FilePreview({ runId, slotKey, fileName, pdf }: { runId: string; slotKey: string; fileName: string; pdf?: PdfFileInfo[] }) {
  const [data, setData] = useState<Preview>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/runs/${runId}/files/${slotKey}`)
      .then((r) => r.json())
      .then((json: Preview & { error?: string }) => {
        if (cancelled) return;
        if (json.error) setError(json.error);
        else setData(json);
      })
      .catch(() => !cancelled && setError("Couldn't load the preview."));
    return () => {
      cancelled = true;
    };
  }, [runId, slotKey, fileName]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return <p className="py-6 text-sm text-muted">Loading preview…</p>;

  const keys = previewFilterKeys(data.headers);
  const numeric = (i: number) => data.kinds[i] === "number";
  const decimals = (i: number) => data.rows.some((r) => typeof r[keys[i]] === "number" && !Number.isInteger(r[keys[i]]));
  // Dropdown filters only where they help: text columns with a handful of values (status, type, method).
  const filterable = data.headers
    .map((h, i) => ({ h, i }))
    .filter(({ i }) => {
      if (data.kinds[i] !== "text") return false;
      const distinct = new Set(data.rows.map((r) => r[keys[i]]).filter((v) => v !== ""));
      return distinct.size > 1 && distinct.size <= 12;
    })
    .slice(0, 4);

  const columns: QueryColumn<PreviewRow>[] = data.headers.map((h, i) => {
    const d = decimals(i);
    return {
      key: keys[i],
      header: h,
      align: numeric(i) ? "right" : "left",
      render: (r) => <span className="block max-w-64 truncate">{fmt(r[keys[i]], d)}</span>,
      // Negative amounts (refunds, reversals, deductions) read in red.
      cellClass: (r) => (typeof r[keys[i]] === "number" && (r[keys[i]] as number) < 0 ? "text-danger font-medium" : undefined),
    };
  });

  const failed = (pdf ?? []).flatMap((p) => p.checks.filter((c) => !c.ok).map((c) => ({ ...c, file: p.fileName })));
  const scanned = (pdf ?? []).filter((p) => p.ocr);

  return (
    <>
      {failed.length > 0 && (
        <div role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <p className="font-medium">Check these rows before running: the PDF didn&apos;t pass {failed.length === 1 ? "a check" : `${failed.length} checks`}.</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {failed.map((c) => (
              <li key={`${c.file}-${c.id}`}>
                {(pdf?.length ?? 0) > 1 && `${c.file}: `}
                {c.label}. {c.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
      {scanned.length > 0 && (
        <div className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          <p className="font-medium">
            {scanned.length === 1 && (pdf?.length ?? 0) === 1 ? "Read from scanned pages by OCR" : `${scanned.length} of these files were read from scans by OCR`}. OCR can misread digits:
            check amounts, dates and references before running.
          </p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {scanned.map((p) => (
              <li key={p.fileName}>
                {(pdf?.length ?? 0) > 1 && `${p.fileName}: `}
                {p.ocr!.pages} page{p.ocr!.pages === 1 ? "" : "s"}, average confidence {p.ocr!.confidence}%
                {p.ocr!.lowConfidenceRows.length > 0 &&
                  `. Least certain: row${p.ocr!.lowConfidenceRows.length === 1 ? "" : "s"} ${p.ocr!.lowConfidenceRows.slice(0, 12).join(", ")}${p.ocr!.lowConfidenceRows.length > 12 ? "…" : ""}`}
                .
              </li>
            ))}
          </ul>
        </div>
      )}
      <QueryTable
        rows={data.rows}
        columns={columns}
        searchFields={keys}
        searchPlaceholder="Search rows"
        filters={filterable.map(({ h, i }) => ({ key: keys[i], label: h, allLabel: `All ${h.toLowerCase()}` }))}
        exportHref={(params) => `/api/runs/${runId}/files/${slotKey}?format=xlsx${params ? `&${params}` : ""}`}
        dense
      />
      {data.total > data.rows.length && (
        <p className="tabular mt-2 text-xs text-muted">
          Previewing the first {data.rows.length.toLocaleString()} of {data.total.toLocaleString()} rows. The Excel download has all of them.
        </p>
      )}
    </>
  );
}

// ─── Save as template (generic reco only) ───────────────────────────────────

function SaveTemplate({ defaultTitle, onSave, busy, saved }: { defaultTitle: string; onSave: (title: string) => void; busy: boolean; saved: boolean }) {
  const [title, setTitle] = useState(defaultTitle);
  return (
    <form
      className="rounded-xl border border-dashed border-border bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(title);
      }}
    >
      <p className="text-sm font-semibold">Save as a reusable template</p>
      <p className="mt-0.5 text-sm text-muted">
        Keeps the two file names, the tolerance and the columns you confirmed. It appears under Your templates, for everyone in this workspace.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={60}
          aria-label="Template name"
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-foreground/40 sm:max-w-80"
        />
        <button type="submit" disabled={busy || saved || !title.trim()} className={buttonClass("secondary")}>
          Save template
        </button>
        {saved && (
          <Link href="/templates" className="text-sm font-medium text-success underline decoration-success/30 underline-offset-4">
            Saved ✓ View templates
          </Link>
        )}
      </div>
    </form>
  );
}
