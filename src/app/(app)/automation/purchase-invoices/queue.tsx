"use client";

import { uploadPresigned as uploadToBlob } from "@vercel/blob/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useRef, useState, useTransition } from "react";
import { PhotoPages } from "@/components/automation/photo-pages";
import { MATCHED_BY, money, PushDialog, ResultList, StatusPill, type Status } from "@/components/automation/shared";
import { buttonClass } from "@/components/ui";
import { approveAction, captureSampleAction, pushAction, refreshErpAction, setTargetAction } from "@/app/actions/automation";
import type { Draft } from "@/lib/automation/purchase-invoices/draft";

// The review queue (D-66): every captured invoice with what Sawwi read, its checks and what
// blocks it, with single and bulk approve, CSV download, and push to Business Central.

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
  layout: string | null;
  erpNumber: string | null;
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
};

const FILTERS: { id: "all" | Status | "open"; label: string }[] = [
  { id: "open", label: "To review" },
  { id: "approved", label: "Approved" },
  { id: "pushed", label: "In ERP" },
  { id: "all", label: "All" },
];

const METHOD: Record<string, string> = { text: "Text PDF", ocr: "Scan (OCR)", zatca_xml: "ZATCA e-invoice", zatca_qr: "ZATCA QR only" };

export function Queue(props: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("open");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ title: string; results: { ok: boolean; message?: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [pushing, setPushing] = useState<string[] | null>(null);
  const [busy, startBusy] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => {
    const c = { open: 0, approved: 0, pushed: 0, all: props.rows.length } as Record<string, number>;
    for (const r of props.rows) {
      if (r.status === "needs_review" || r.status === "ready") c.open++;
      if (r.status === "approved") c.approved++;
      if (r.status === "pushed") c.pushed++;
    }
    return c;
  }, [props.rows]);

  const shown = props.rows.filter((r) =>
    filter === "all" ? true : filter === "open" ? r.status === "needs_review" || r.status === "ready" || r.status === "pushing" : r.status === filter,
  );
  const shownIds = shown.map((r) => r.id);
  const picked = props.rows.filter((r) => selected.has(r.id));
  const allShownPicked = shown.length > 0 && shownIds.every((id) => selected.has(id));
  const toggle = (id: string) => setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  const toggleAll = () => setSelected(allShownPicked ? new Set([...selected].filter((id) => !shownIds.includes(id))) : new Set([...selected, ...shownIds]));
  const toggleExpand = (id: string) => setExpanded((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));

  const approvable = picked.filter((r) => (r.status === "ready" || r.status === "needs_review") && r.blockers.length === 0);
  const pushable = picked.filter((r) => r.status === "approved");

  const approve = (ids: string[]) =>
    startBusy(async () => {
      setError(null);
      const res = await approveAction(ids);
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
      if (res.error) return setError(res.error);
      const ok = res.results!.filter((r) => r.ok).length;
      setNotice({ title: `${ok} of ${items.length} pushed to Business Central as drafts.`, results: res.results! });
      setSelected(new Set());
      router.refresh();
    });

  /** True when at least one file was read. */
  async function upload(files: File[]): Promise<boolean> {
    const pdfs = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length === 0) return (setError("Upload supplier invoices as PDF files."), false);
    if (pdfs.some((f) => f.size > 10 * 1024 * 1024)) return (setError("Each PDF must be under 10 MB."), false);
    setError(null);
    setNotice(null);
    const results: { ok: boolean; message?: string }[] = [];
    try {
      // One request per file: each reads in its own time (scans take a few seconds a page).
      for (const [i, file] of pdfs.entries()) {
        setUploading(`Reading ${i + 1} of ${pdfs.length}: ${file.name}`);
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
        const json = (await res.json()) as { results?: { name: string; existing?: boolean; error?: string }[]; error?: string };
        if (json.error) results.push({ ok: false, message: `${file.name}: ${json.error}` });
        for (const r of json.results ?? []) results.push(r.error ? { ok: false, message: r.error } : { ok: true, message: r.existing ? `${r.name} was uploaded before; it's the draft already listed.` : `${r.name} read.` });
      }
    } catch {
      results.push({ ok: false, message: "Upload failed. Check your connection and try again." });
    } finally {
      setUploading(null);
      if (fileRef.current) fileRef.current.value = "";
    }
    setFilter("open");
    setNotice({ title: `${results.filter((r) => r.ok).length} of ${pdfs.length} invoices read.`, results });
    router.refresh();
    return results.some((r) => r.ok);
  }

  const sample = (id: string) =>
    startBusy(async () => {
      setError(null);
      setUploading("Reading the sample…");
      const res = await captureSampleAction(id);
      setUploading(null);
      if (res.error) return setError(res.error);
      setFilter("open");
      setNotice({ title: res.existing ? "That sample is already in the list." : "Sample read. Review it below.", results: [] });
      router.refresh();
    });

  const onTarget = (value: string) =>
    startBusy(async () => {
      const res = await setTargetAction(value || null);
      if (res.error) setError(res.error);
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
              <PhotoPages disabled={Boolean(uploading)} onReady={(pdf) => upload([pdf])} />
            </div>
            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void upload([...e.dataTransfer.files]);
              }}
              className="flex cursor-pointer flex-col items-center rounded-xl border border-dashed border-border p-8 text-center hover:bg-surface-muted/50"
            >
              <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple className="sr-only" disabled={Boolean(uploading)} onChange={(e) => void upload([...(e.target.files ?? [])])} />
              <span className="font-medium">Drop supplier invoice PDFs here, or click to choose</span>
              <span className="mt-1 text-sm text-muted">One invoice per PDF, up to 50 at a time. Text PDFs, scans and ZATCA e-invoices.</span>
            </label>
            </>
          )}
          {uploading && (
            <p className="mt-3 text-sm text-muted" role="status">
              {uploading}
            </p>
          )}
        </section>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
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
          {counts.approved > 0 && (
            <a href="/api/automation/purchase-invoices/export?approved=1" className={`${buttonClass("secondary")} ml-auto`}>
              Download approved as CSV
            </a>
          )}
        </div>

        {picked.length > 0 && props.canEdit && (
          <div className="sticky top-14 z-10 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand-soft px-3 py-2 text-sm md:top-2">
            <span className="font-medium">{picked.length} selected</span>
            <button type="button" className={buttonClass("primary")} disabled={busy || approvable.length === 0} onClick={() => approve(approvable.map((r) => r.id))}>
              Approve {approvable.length || ""}
            </button>
            <a href={`/api/automation/purchase-invoices/export?ids=${picked.map((r) => r.id).join(",")}`} className={buttonClass("secondary")}>
              Download CSV
            </a>
            {props.target && (
              <button type="button" className={buttonClass("secondary")} disabled={busy || pushable.length === 0} onClick={() => setPushing(pushable.map((r) => r.id))}>
                Push {pushable.length || ""} approved to Business Central
              </button>
            )}
            {picked.length > approvable.length + pushable.length && (
              <span className="text-xs text-muted">{picked.length - approvable.length - pushable.length} can&apos;t be approved yet: open them to fix what&apos;s flagged.</span>
            )}
            <button type="button" className="ml-auto text-muted hover:text-foreground" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        )}

        {shown.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">
            {props.rows.length === 0 ? "No invoices yet. Upload supplier invoice PDFs above." : "Nothing here."}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[56rem] text-sm">
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
                            {METHOD[r.method] ?? r.method}
                            {r.layout === "remembered" ? " · layout remembered" : ""}
                          </p>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <p>{d.invoiceDate || <span className="text-warn">missing</span>}</p>
                          <p className="text-xs text-muted">{d.dueDate ? `due ${d.dueDate}` : "no due date"}</p>
                        </td>
                        <td className="px-3 py-3">
                          <button type="button" className="text-left underline decoration-dotted underline-offset-2" onClick={() => toggleExpand(r.id)} aria-expanded={open}>
                            {d.lines.length} line{d.lines.length === 1 ? "" : "s"}
                          </button>
                          {props.target && uncoded > 0 && <p className="text-xs text-warn">{uncoded} not coded</p>}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{money(d.subtotal)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{money(d.vat)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          <p className="font-medium">{money(d.total, d.currency)}</p>
                          <p className={`text-xs ${r.checksOk ? "text-success" : "text-danger"}`}>{r.checksOk ? "✓ totals check" : "✕ totals don't add up"}</p>
                        </td>
                        <td className="px-3 py-3">
                          <StatusPill status={r.status} />
                          {r.erpNumber && <p className="mt-1 text-xs text-muted">{r.erpNumber}</p>}
                          {r.status !== "pushed" && r.blockers.length > 0 && (
                            <p className="mt-1 max-w-48 text-xs text-warn" title={r.blockers.join("\n")}>
                              {r.blockers[0]}
                              {r.blockers.length > 1 ? ` (+${r.blockers.length - 1})` : ""}
                            </p>
                          )}
                          {r.warnings.some((w) => /duplicate|same supplier and invoice/i.test(w)) && <p className="mt-1 text-xs text-danger">Possible duplicate</p>}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          <Link href={`/automation/purchase-invoices/${r.id}`} className="text-sm font-medium text-brand hover:underline">
                            {r.status === "pushed" ? "View" : "Review"}
                          </Link>
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
                            <table className="w-full text-xs">
                              <thead className="text-left text-muted">
                                <tr>
                                  <th className="py-1 pr-3 font-medium">#</th>
                                  <th className="py-1 pr-3 font-medium">Description</th>
                                  <th className="py-1 pr-3 font-medium">Supplier SKU</th>
                                  <th className="py-1 pr-3 font-medium">ERP item / account</th>
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
