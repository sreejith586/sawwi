"use client";

import { LimitText } from "@/components/billing/limit-text";
import { outcomeOf } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/track";
import { uploadPresigned as uploadToBlob } from "@vercel/blob/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { PhotoPages } from "@/components/automation/photo-pages";
import { UploadProgress, type UploadItem } from "@/components/automation/upload-progress";
import { MATCHED_BY, money, PushDialog, ResultList, StatusPill, type Status } from "@/components/automation/shared";
import { buttonClass } from "@/components/ui";
import { approveAction, captureSampleAction, pushAction, refreshErpAction, rereadManyAction, retryReadAction, setTargetAction } from "@/app/actions/automation";
import type { Draft } from "@/lib/automation/purchase-invoices/draft";

// The review queue (D-66): every captured invoice with what Sawwi read, its checks and what
// blocks it, with single and bulk approve, CSV or Excel download, and push to Business Central.
// Invoices Sawwi couldn't read, or couldn't push, wait in the Failed tab for a retry (D-86).

export type QueueRow = {
  id: string;
  fileName: string;
  status: Status;
  draft: Draft;
  blockers: string[];
  warnings: string[];
  checksOk: boolean;
  hash: string;
  method: string;
  /** Read by AI (D-69). */
  ai: boolean;
  layout: string | null;
  erpNumber: string | null;
  /** What went wrong last (D-86). */
  failure: { stage: "read" | "push"; message: string; attempts: number } | null;
  createdAt: string;
};

type Props = {
  rows: QueueRow[];
  targets: { connectionId: string; label: string }[];
  target: { connectionId: string; label: string } | null;
  masterFetchedAt: string | null;
  canEdit: boolean;
  demo: boolean;
  samples: { id: string; title: string; shows: string }[];
  directUploads: boolean;
  incomingFolder: string;
  /** AI reading is on for this workspace (D-69). */
  aiAvailable: boolean;
};

const FILTERS: { id: "all" | Status | "open"; label: string }[] = [
  { id: "open", label: "To review" },
  { id: "failed", label: "Failed" },
  { id: "approved", label: "Approved" },
  { id: "pushed", label: "In ERP" },
  { id: "all", label: "All" },
];

/** Couldn't be read, or the last push failed and it's still waiting to go (D-86). */
const isFailed = (r: QueueRow) => r.status === "failed" || (r.failure?.stage === "push" && r.status === "approved");

/** Invoices read at once in a bulk upload (D-93). Each is its own request; three keeps a scan batch moving without crowding the server. */
const UPLOAD_PARALLEL = 3;

const METHOD: Record<string, string> = { text: "Text PDF", ocr: "Scan (OCR)", zatca_xml: "ZATCA e-invoice", zatca_qr: "ZATCA QR only" };

export function Queue(props: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("open");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ title: string; results: { ok: boolean; message?: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ items: UploadItem[]; startedAt: number } | null>(null);
  // Leaving the page mid-upload stops the files not sent yet: the browser asks first.
  useEffect(() => {
    if (!progress) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [progress]);
  const [pushing, setPushing] = useState<string[] | null>(null);
  const [busy, startBusy] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => {
    const c = { open: 0, failed: 0, approved: 0, pushed: 0, all: props.rows.length } as Record<string, number>;
    for (const r of props.rows) {
      if (isFailed(r)) c.failed++;
      if (r.status === "needs_review" || r.status === "ready") c.open++;
      if (r.status === "approved") c.approved++;
      if (r.status === "pushed") c.pushed++;
    }
    return c;
  }, [props.rows]);

  const shown = props.rows.filter((r) =>
    filter === "all"
      ? true
      : filter === "open"
        ? r.status === "needs_review" || r.status === "ready" || r.status === "pushing"
        : filter === "failed"
          ? isFailed(r)
          : r.status === filter,
  );
  const shownIds = shown.map((r) => r.id);
  const picked = props.rows.filter((r) => selected.has(r.id));
  const allShownPicked = shown.length > 0 && shownIds.every((id) => selected.has(id));
  const toggle = (id: string) => setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  const toggleAll = () => setSelected(allShownPicked ? new Set([...selected].filter((id) => !shownIds.includes(id))) : new Set([...selected, ...shownIds]));
  const toggleExpand = (id: string) => setExpanded((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));

  const approvable = picked.filter((r) => (r.status === "ready" || r.status === "needs_review") && r.blockers.length === 0);
  const pushable = picked.filter((r) => r.status === "approved");
  const retryable = picked.filter((r) => r.status === "failed");
  // Drafts not read by AI yet, e.g. from before AI reading was on (D-89).
  const aiReadable = picked.filter((r) => !r.ai && r.status !== "pushed" && r.status !== "pushing" && r.status !== "failed");

  const readWithAi = (ids: string[]) =>
    startBusy(async () => {
      setError(null);
      setUploading(`Reading ${ids.length === 1 ? "the invoice" : `${ids.length} invoices`} with AI…`);
      const res = await rereadManyAction(ids);
      setUploading(null);
      track("invoice_ai_read", { count: ids.length, ok_count: res.results?.filter((r) => r.ok).length ?? 0, location: "queue" });
      if (res.error) return setError(res.error);
      setNotice({ title: `${res.results!.filter((r) => r.ok).length} of ${ids.length} read with AI. Check them before approving.`, results: res.results! });
      setSelected(new Set());
      router.refresh();
    });
  const idsParam = picked.map((r) => r.id).join(",");

  const retry = (ids: string[]) =>
    startBusy(async () => {
      setError(null);
      setUploading(`Reading ${ids.length === 1 ? "the invoice" : `${ids.length} invoices`} again…`);
      const res = await retryReadAction(ids);
      setUploading(null);
      track("invoice_retry", { count: ids.length, ok_count: res.results?.filter((r) => r.ok).length ?? 0, location: "queue" });
      if (res.error) return setError(res.error);
      const ok = res.results!.filter((r) => r.ok).length;
      setNotice({ title: `${ok} of ${ids.length} read. ${ok ? "They're in To review." : "Open one to type it in from the PDF."}`, results: res.results! });
      setSelected(new Set());
      router.refresh();
    });

  const approve = (ids: string[]) =>
    startBusy(async () => {
      setError(null);
      const res = await approveAction(ids);
      track("invoice_approve", { count: ids.length, ok_count: res.results?.filter((r) => r.ok).length ?? 0, location: "queue" });
      if (res.error) return setError(res.error);
      const ok = res.results!.filter((r) => r.ok).length;
      setNotice({ title: `${ok} of ${ids.length} approved.`, results: res.results! });
      setSelected(new Set());
      router.refresh();
    });

  const push = () =>
    startBusy(async () => {
      const items = props.rows.filter((r) => pushing?.includes(r.id)).map((r) => ({ id: r.id, hash: r.hash }));
      const res = await pushAction(items);
      setPushing(null);
      const pushed = res.results?.filter((r) => r.ok).length ?? 0;
      track("invoice_push", { count: items.length, ok_count: pushed, failed_count: items.length - pushed, outcome: outcomeOf(pushed, items.length), location: "queue" });
      if (res.error) return setError(res.error);
      const ok = res.results!.filter((r) => r.ok).length;
      setNotice({ title: `${ok} of ${items.length} pushed to Business Central as drafts.`, results: res.results! });
      setSelected(new Set());
      router.refresh();
    });

  /** True when at least one file was read. */
  /** True when at least one file was read. Files are read a few at a time, with progress for each (D-93). */
  async function upload(files: File[], source: "pdf" | "photo" = "pdf"): Promise<boolean> {
    const pdfs = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length === 0) return (setError("Upload supplier invoices as PDF files."), false);
    if (pdfs.some((f) => f.size > 10 * 1024 * 1024)) return (setError("Each PDF must be under 10 MB."), false);
    setError(null);
    setNotice(null);
    const results: { ok: boolean; message?: string }[] = [];
    // Same-named files get a suffix in the list so each has its own row.
    const names = pdfs.map((f, i) => (pdfs.findIndex((g) => g.name === f.name) === i ? f.name : `${f.name} (${i + 1})`));
    let items: UploadItem[] = names.map((name) => ({ name, state: "waiting" }));
    const set = (i: number, patch: Partial<UploadItem>) => {
      items = items.map((x, j) => (j === i ? { ...x, ...patch } : x));
      setProgress((p) => (p ? { ...p, items } : p));
    };
    setProgress({ items, startedAt: Date.now() });

    const readOne = async (i: number) => {
      const file = pdfs[i];
      const started = Date.now();
      set(i, { state: "reading", startedAt: started });
      try {
        let res: Response;
        if (props.directUploads) {
          const safe = file.name.replace(/[^\w.\- ]+/g, "_").slice(-80);
          const blob = await uploadToBlob(`${props.incomingFolder}${Date.now()}-${i}-${safe}`, file, {
            access: "private",
            handleUploadUrl: "/api/automation/purchase-invoices/uploads",
            contentType: "application/pdf",
          });
          res = await fetch("/api/automation/purchase-invoices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uploads: [{ pathname: blob.pathname, name: file.name }] }) });
        } else {
          const body = new FormData();
          body.append("file", file);
          res = await fetch("/api/automation/purchase-invoices", { method: "POST", body });
        }
        const json = (await res.json()) as { results?: { name: string; existing?: boolean; failed?: boolean; error?: string }[]; error?: string };
        let ok = false;
        if (json.error) results.push({ ok: false, message: `${file.name}: ${json.error}` });
        for (const r of json.results ?? []) {
          ok = !r.error && !r.failed;
          results.push(
            r.error
              ? { ok: false, message: r.error }
              : r.failed
                ? { ok: false, message: `${r.name} couldn't be read. It's kept under Failed: retry it, or open it and type it in.` }
                : { ok: true, message: r.existing ? `${r.name} was uploaded before; it's the draft already listed.` : `${r.name} read.` },
          );
        }
        set(i, { state: ok ? "done" : "failed", ms: Date.now() - started, note: json.error ?? json.results?.[0]?.error });
      } catch {
        results.push({ ok: false, message: `${file.name}: upload failed. Check your connection and try again.` });
        set(i, { state: "failed", ms: Date.now() - started });
      }
    };

    try {
      // A few at a time: each file is its own request and reads in its own time.
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(UPLOAD_PARALLEL, pdfs.length) }, async () => {
          while (next < pdfs.length) await readOne(next++);
        }),
      );
    } finally {
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
    setFilter(results.some((r) => r.ok) || !results.some((r) => /under Failed/.test(r.message ?? "")) ? "open" : "failed");
    const read = results.filter((r) => r.ok).length;
    track("invoice_upload", { count: pdfs.length, ok_count: read, failed_count: pdfs.length - read, source });
    setNotice({ title: `${read} of ${pdfs.length} invoices read.`, results });
    router.refresh();
    return results.some((r) => r.ok);
  }

  const sample = (id: string) =>
    startBusy(async () => {
      setError(null);
      setUploading("Reading the sample…");
      const res = await captureSampleAction(id);
      setUploading(null);
      track("invoice_upload", { count: 1, ok_count: res.error ? 0 : 1, failed_count: res.error ? 1 : 0, source: "sample" });
      if (res.error) return setError(res.error);
      setFilter("open");
      setNotice({ title: res.existing ? "That sample is already in the list." : "Sample read. Review it below.", results: [] });
      router.refresh();
    });

  const onTarget = (value: string) =>
    startBusy(async () => {
      const res = await setTargetAction(value || null);
      if (res.error) setError(res.error);
      else track("settings_change", { setting: "push_target", value: value ? "erp" : "csv" });
      router.refresh();
    });

  const refreshErp = () =>
    startBusy(async () => {
      const res = await refreshErpAction();
      if (res.error) return setError(res.error);
      setNotice({ title: `Read vendors, items and accounts again. ${res.changed} draft${res.changed === 1 ? "" : "s"} updated.`, results: [] });
      router.refresh();
    });

  return (
    <div className="mt-6 space-y-6">
      {/* Where approved invoices go. */}
      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
        <label htmlFor="pi-target" className="font-medium">
          Push to
        </label>
        <select
          id="pi-target"
          className="h-9 min-w-64 rounded-lg border border-border bg-surface px-3"
          value={props.target?.connectionId ?? ""}
          onChange={(e) => onTarget(e.target.value)}
          disabled={!props.canEdit || busy}
        >
          <option value="">No ERP: CSV download only</option>
          {props.targets.map((t) => (
            <option key={t.connectionId} value={t.connectionId}>
              {t.label}
            </option>
          ))}
        </select>
        {props.target ? (
          <>
            <span className="text-xs text-muted">
              {props.masterFetchedAt ? `Vendors and items read ${new Date(props.masterFetchedAt).toLocaleString()}` : "Vendors and items not read yet"}
            </span>
            {props.canEdit && (
              <button type="button" className={`${buttonClass("secondary")} ml-auto`} onClick={refreshErp} disabled={busy}>
                Refresh from Business Central
              </button>
            )}
          </>
        ) : (
          props.targets.length === 0 &&
          !props.demo && (
            <span className="text-xs text-muted">
              To push, <Link href="/settings/connections" className="underline">connect Business Central</Link>. You can still review and download CSV.
            </span>
          )
        )}
      </section>

      {/* Invoices in. */}
      {props.canEdit && (
        <section>
          {props.demo ? (
            <div className="rounded-xl border border-dashed border-border p-5">
              <p className="font-medium">Try a sample supplier invoice</p>
              <p className="mt-1 text-sm text-muted">The live demo takes no uploads. Each sample is a made-up invoice for the demo company, read just as an upload would be.</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {props.samples.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => sample(s.id)}
                    disabled={busy || Boolean(uploading)}
                    className="rounded-lg border border-border bg-surface p-3 text-left text-sm transition-colors hover:bg-surface-muted disabled:opacity-50"
                  >
                    <span className="font-medium">{s.title}</span>
                    <span className="mt-0.5 block text-xs text-muted">{s.shows}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
            {/* Phones and tablets: photograph the invoice, one photo per page (D-67). */}
            <div className="mb-3 md:hidden">
              <PhotoPages disabled={Boolean(uploading || progress)} onReady={(pdf) => upload([pdf], "photo")} />
            </div>
            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void upload([...e.dataTransfer.files]);
              }}
              className="flex cursor-pointer flex-col items-center rounded-xl border border-dashed border-border p-8 text-center hover:bg-surface-muted/50"
            >
              <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple className="sr-only" disabled={Boolean(uploading || progress)} onChange={(e) => void upload([...(e.target.files ?? [])])} />
              <span className="font-medium">Drop supplier invoice PDFs here, or click to choose</span>
              <span className="mt-1 text-sm text-muted">One invoice per PDF, up to 50 at a time. Text PDFs, scans and ZATCA e-invoices.</span>
            </label>
            </>
          )}
          {progress && <UploadProgress items={progress.items} startedAt={progress.startedAt} parallel={UPLOAD_PARALLEL} />}
          {uploading && !progress && (
            <p className="mt-3 text-sm text-muted" role="status">
              {uploading}
            </p>
          )}
        </section>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          <LimitText text={error} />
        </p>
      )}
      {notice && (
        <div role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium">{notice.title}</p>
            <button type="button" className="text-muted hover:text-foreground" onClick={() => setNotice(null)} aria-label="Dismiss">
              ✕
            </button>
          </div>
          <ResultList results={notice.results} />
        </div>
      )}

      {/* The queue. */}
      <section>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5" role="tablist" aria-label="Filter invoices">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`rounded-md px-3 py-1 text-sm ${filter === f.id ? "bg-brand-soft font-medium text-foreground" : "text-muted hover:text-foreground"}`}
              >
                {f.label} <span className="text-xs text-muted">{counts[f.id]}</span>
              </button>
            ))}
          </div>
          {shown.length > 0 && (
            // Everything in the tab in one file (D-90): the Invoices sheet lists each one with its status and what's open.
            <span className="ml-auto flex gap-2">
              <a href={`/api/automation/purchase-invoices/export?scope=${filter}&format=xlsx`} className={buttonClass("secondary")} onClick={() => track("invoice_export", { format: "xlsx", scope: "tab", count: shown.length })}>
                Download {filter === "all" ? "all" : `these`} {shown.length} as Excel
              </a>
              <a href={`/api/automation/purchase-invoices/export?scope=${filter}`} className={buttonClass("secondary")} onClick={() => track("invoice_export", { format: "csv", scope: "tab", count: shown.length })}>
                CSV
              </a>
            </span>
          )}
        </div>

        {picked.length > 0 && props.canEdit && (
          <div className="sticky top-14 z-10 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand-soft px-3 py-2 text-sm md:top-2">
            <span className="font-medium">{picked.length} selected</span>
            <button type="button" className={buttonClass("primary")} disabled={busy || approvable.length === 0} onClick={() => approve(approvable.map((r) => r.id))}>
              Approve {approvable.length || ""}
            </button>
            {props.aiAvailable && aiReadable.length > 0 && (
              <button type="button" className={buttonClass("secondary")} disabled={busy} onClick={() => readWithAi(aiReadable.map((r) => r.id))} title="Each PDF is read by AI once; an earlier reading is reused at no cost.">
                Read {aiReadable.length} with AI
              </button>
            )}
            {retryable.length > 0 && (
              <button type="button" className={buttonClass("secondary")} disabled={busy} onClick={() => retry(retryable.map((r) => r.id))}>
                Retry {retryable.length} failed
              </button>
            )}
            <a href={`/api/automation/purchase-invoices/export?ids=${idsParam}&format=xlsx`} className={buttonClass("secondary")} onClick={() => track("invoice_export", { format: "xlsx", scope: "selected", count: picked.length })}>
              Export {picked.length} to Excel
            </a>
            <a href={`/api/automation/purchase-invoices/export?ids=${idsParam}`} className={buttonClass("secondary")} onClick={() => track("invoice_export", { format: "csv", scope: "selected", count: picked.length })}>
              CSV
            </a>
            {props.target && (
              <button type="button" className={buttonClass("secondary")} disabled={busy || pushable.length === 0} onClick={() => setPushing(pushable.map((r) => r.id))}>
                Push {pushable.length || ""} approved to Business Central
              </button>
            )}
            {picked.length > approvable.length + pushable.length + retryable.length && (
              <span className="text-xs text-muted">
                {picked.length - approvable.length - pushable.length - retryable.length} can&apos;t be approved yet: open them to fix what&apos;s flagged.
              </span>
            )}
            <button type="button" className="ml-auto text-muted hover:text-foreground" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        )}

        {shown.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">
            {props.rows.length === 0
              ? "No invoices yet. Upload supplier invoice PDFs above."
              : filter === "failed"
                ? "Nothing failed. Invoices Sawwi can't read, or can't push, wait here for a retry."
                : "Nothing here."}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface">
            <table data-clarity-mask="True" className="w-full min-w-[56rem] text-sm">
              <thead className="bg-surface-muted text-left text-xs text-muted">
                <tr>
                  <th className="w-10 px-3 py-2">
                    {props.canEdit && <input type="checkbox" aria-label="Select all shown" checked={allShownPicked} onChange={toggleAll} />}
                  </th>
                  <th className="px-3 py-2 font-medium">Supplier → vendor</th>
                  <th className="px-3 py-2 font-medium">Invoice</th>
                  <th className="px-3 py-2 font-medium">Date · due</th>
                  <th className="px-3 py-2 font-medium">Lines</th>
                  <th className="px-3 py-2 text-right font-medium">Net</th>
                  <th className="px-3 py-2 text-right font-medium">VAT</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const d = r.draft;
                  const uncoded = d.lines.filter((l) => !l.erpNo).length;
                  const open = expanded.has(r.id);
                  return (
                    <Fragment key={r.id}>
                      <tr className="border-t border-border align-top">
                        <td className="px-3 py-3">
                          {props.canEdit && <input type="checkbox" aria-label={`Select ${d.invoiceNumber || r.fileName}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />}
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-medium">{d.supplierName || r.fileName}</p>
                          <p className="text-xs text-muted">{d.supplierTrn ? `TRN ${d.supplierTrn}` : "No TRN"}</p>
                          {props.target && (
                            <p className={`text-xs ${d.vendorNo ? "text-success" : "text-warn"}`}>
                              {d.vendorNo ? `→ ${d.vendorNo} ${d.vendorName} (${MATCHED_BY[d.vendorMatchedBy ?? "user"]})` : "→ no vendor yet"}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <p>{d.invoiceNumber || <span className="text-warn">missing</span>}</p>
                          <p className="text-xs text-muted">
                            {r.status === "failed" ? "Not read" : r.ai ? "Read by AI" : (METHOD[r.method] ?? r.method)}
                            {r.layout === "remembered" && !r.ai ? " · layout remembered" : ""}
                          </p>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          {r.status === "failed" ? (
                            <p className="text-muted">—</p>
                          ) : (
                            <>
                              <p>{d.invoiceDate || <span className="text-warn">missing</span>}</p>
                              <p className="text-xs text-muted">{d.dueDate ? `due ${d.dueDate}` : "no due date"}</p>
                            </>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <button type="button" className="text-left underline decoration-dotted underline-offset-2" onClick={() => toggleExpand(r.id)} aria-expanded={open}>
                            {d.lines.length} line{d.lines.length === 1 ? "" : "s"}
                          </button>
                          {props.target && uncoded > 0 && r.status !== "failed" && <p className="text-xs text-warn">{uncoded} not coded</p>}
                          {d.postTo === "order" && (
                            <p className={`text-xs ${d.poConfirmed ? "text-success" : "text-warn"}`}>
                              {d.poConfirmed ? "✓ " : "PO suggested: "}
                              {[...new Set(d.lines.flatMap((l) => (l.po ? [l.po.orderNumber] : [])))].join(", ")}
                              {d.lines.some((l) => l.grn) ? ` · GRN ${[...new Set(d.lines.flatMap((l) => (l.grn ? [l.grn.number] : [])))].join(", ")}` : ""}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{money(d.subtotal)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{money(d.vat)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          <p className="font-medium">{money(d.total, d.currency)}</p>
                          {r.status !== "failed" && (
                            <p className={`text-xs ${r.checksOk ? "text-success" : "text-danger"}`}>{r.checksOk ? "✓ totals check" : "✕ totals don't add up"}</p>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <StatusPill status={r.status} />
                          {r.erpNumber && <p className="mt-1 text-xs text-muted">{r.erpNumber}</p>}
                          {r.failure && r.status !== "pushed" && (
                            <p className="mt-1 max-w-56 text-xs text-danger" title={r.failure.message}>
                              {r.failure.stage === "push" ? "Push failed: " : ""}
                              {r.failure.message}
                              {r.failure.attempts > 1 ? ` (${r.failure.attempts} tries)` : ""}
                            </p>
                          )}
                          {r.status !== "pushed" && r.status !== "failed" && r.blockers.length > 0 && (
                            <p className="mt-1 max-w-48 text-xs text-warn" title={r.blockers.join("\n")}>
                              {r.blockers[0]}
                              {r.blockers.length > 1 ? ` (+${r.blockers.length - 1})` : ""}
                            </p>
                          )}
                          {r.warnings.some((w) => /duplicate|same supplier and invoice/i.test(w)) && <p className="mt-1 text-xs text-danger">Possible duplicate</p>}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          <Link href={`/automation/purchase-invoices/${r.id}`} className="text-sm font-medium text-brand hover:underline">
                            {r.status === "pushed" ? "View" : r.status === "failed" ? "Type in" : "Review"}
                          </Link>
                          {props.canEdit && r.status === "failed" && (
                            <button type="button" className="ml-3 text-sm text-muted hover:text-foreground" disabled={busy} onClick={() => retry([r.id])}>
                              Retry
                            </button>
                          )}
                          {props.canEdit && props.target && r.status === "approved" && r.failure?.stage === "push" && (
                            <button type="button" className="ml-3 text-sm text-muted hover:text-foreground" disabled={busy} onClick={() => setPushing([r.id])}>
                              Retry push
                            </button>
                          )}
                          {props.canEdit && r.status === "ready" && (
                            <button type="button" className="ml-3 text-sm text-muted hover:text-foreground" disabled={busy} onClick={() => approve([r.id])}>
                              Approve
                            </button>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-surface-muted/40">
                          <td />
                          <td colSpan={9} className="px-3 pb-4">
                            <table data-clarity-mask="True" className="w-full text-xs">
                              <thead className="text-left text-muted">
                                <tr>
                                  <th className="py-1 pr-3 font-medium">#</th>
                                  <th className="py-1 pr-3 font-medium">Description</th>
                                  <th className="py-1 pr-3 font-medium">Supplier SKU</th>
                                  <th className="py-1 pr-3 font-medium">ERP item / account</th>
                                  <th className="py-1 pr-3 font-medium">PO · GRN</th>
                                  <th className="py-1 pr-3 text-right font-medium">Qty</th>
                                  <th className="py-1 pr-3 text-right font-medium">Unit price</th>
                                  <th className="py-1 pr-3 text-right font-medium">VAT %</th>
                                  <th className="py-1 pr-3 text-right font-medium">Net</th>
                                  <th className="py-1 text-right font-medium">VAT</th>
                                </tr>
                              </thead>
                              <tbody>
                                {d.lines.map((l, i) => (
                                  <tr key={i} className="border-t border-border/60">
                                    <td className="py-1 pr-3">{i + 1}</td>
                                    <td className="py-1 pr-3">{l.description}</td>
                                    <td className="py-1 pr-3">{l.sku}</td>
                                    <td className={`py-1 pr-3 ${l.erpNo ? "" : "text-warn"}`}>
                                      {l.erpNo ? `${l.erpType === "account" ? "G/L " : ""}${l.erpNo} (${MATCHED_BY[l.matchedBy ?? "user"]})` : "not coded"}
                                    </td>
                                    <td className="py-1 pr-3">
                                      {l.po ? (
                                        <span title={`${l.po.open} received and not invoiced at ${l.po.poPrice}`}>
                                          {l.po.orderNumber}
                                          {l.po.receipts.length ? ` · ${l.po.receipts.join(", ")}` : ""}
                                        </span>
                                      ) : (
                                        <span className="text-muted">—</span>
                                      )}
                                    </td>
                                    <td className="py-1 pr-3 text-right tabular-nums">{l.qty ?? "—"}</td>
                                    <td className="py-1 pr-3 text-right tabular-nums">{money(l.unitPrice)}</td>
                                    <td className="py-1 pr-3 text-right tabular-nums">{l.vatRate ?? "—"}</td>
                                    <td className="py-1 pr-3 text-right tabular-nums">{money(l.net)}</td>
                                    <td className="py-1 text-right tabular-nums">{money(l.vat)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {[...r.blockers, ...r.warnings].length > 0 && (
                              <ul className="mt-2 space-y-0.5 text-xs">
                                {r.blockers.map((b) => (
                                  <li key={b} className="text-warn">
                                    • {b}
                                  </li>
                                ))}
                                {r.warnings.map((w) => (
                                  <li key={w} className="text-muted">
                                    • {w}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <PushDialog
        open={pushing !== null}
        target={props.target?.label ?? "Business Central"}
        items={props.rows.filter((r) => pushing?.includes(r.id)).map((r) => ({ id: r.id, hash: r.hash, draft: r.draft }))}
        busy={busy}
        onCancel={() => setPushing(null)}
        onConfirm={push}
      />
    </div>
  );
}
