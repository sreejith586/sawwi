"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { MATCHED_BY, money, PushDialog, ResultList, StatusPill, type Status } from "@/components/automation/shared";
import { buttonClass } from "@/components/ui";
import { approveAction, discardAction, erpDuplicatesAction, pushAction, saveDraftAction, unapproveAction } from "@/app/actions/automation";
import { reviewDraft, type Draft, type DraftLine } from "@/lib/automation/purchase-invoices/draft";

// One invoice: the supplier's PDF (text or scan) next to everything Sawwi read from it, editable,
// with the checks run live as you type (D-61, D-66). Approve, download, push, or delete.

type View = {
  id: string;
  fileName: string;
  status: Status;
  draft: Draft;
  hash: string;
  duplicates: { id: string; invoiceNumber: string; fileName: string; exact: boolean }[];
  source: { method: string; pages: number; layout?: string; ocr?: { pages: number; confidence: number }; checks: { label: string; ok: boolean; detail: string }[]; sample?: boolean };
  erp: { company: string; number: string; erpTotal: number | null; pushedAt: string } | null;
  approvedAt: string | null;
  serverBlockers: string[];
  serverWarnings: string[];
};

type Master = { company: string; vendors: { number: string; name: string; trn: string }[]; items: { number: string; name: string }[]; accounts: { number: string; name: string }[] };

const r2 = (n: number) => Math.round(n * 100) / 100;
const METHOD: Record<string, string> = { text: "the PDF's text", ocr: "OCR of the scan", zatca_xml: "the embedded ZATCA e-invoice XML", zatca_qr: "the ZATCA QR code only" };
const input = "h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm disabled:bg-surface-muted/50 disabled:text-muted";
const cell = "h-8 w-full rounded-md border border-border bg-surface px-2 text-sm disabled:border-transparent disabled:bg-transparent";

function NumberInput(props: { value: number | null; onChange: (n: number | null) => void; disabled?: boolean; label: string; className?: string }) {
  const [text, setText] = useState(props.value === null ? "" : String(props.value));
  const [shown, setShown] = useState(props.value);
  // The value changed from outside (e.g. net worked out from qty × price): show it.
  if (props.value !== shown) {
    setShown(props.value);
    const typed = text.replace(/,/g, "").trim();
    if (typed === "" ? props.value !== null : Number(typed) !== props.value) setText(props.value === null ? "" : String(props.value));
  }
  return (
    <input
      inputMode="decimal"
      aria-label={props.label}
      className={`${props.className ?? cell} text-right tabular-nums`}
      value={text}
      disabled={props.disabled}
      onChange={(e) => {
        setText(e.target.value);
        const v = e.target.value.replace(/,/g, "").trim();
        if (v === "") props.onChange(null);
        else if (Number.isFinite(Number(v))) props.onChange(Number(v));
      }}
    />
  );
}

export function Review({ view, target, master, canEdit }: { view: View; target: { connectionId: string; label: string } | null; master: Master | null; canEdit: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(view.draft);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ title: string; results: { ok: boolean; message?: string }[] } | null>(null);
  const [erpDupes, setErpDupes] = useState<{ number: string; status: string }[] | null>(null);
  const [pushing, setPushing] = useState(false);
  const [busy, start] = useTransition();
  const locked = !canEdit || view.status === "pushed" || view.status === "pushing";

  // Already in Business Central? Checked when the draft opens (D-63).
  useEffect(() => {
    if (!target || view.status === "pushed" || !view.draft.vendorNo || !view.draft.invoiceNumber) return;
    let live = true;
    void erpDuplicatesAction(view.id).then((r) => live && setErpDupes(r.refs ?? null));
    return () => {
      live = false;
    };
  }, [target, view.id, view.status, view.draft.vendorNo, view.draft.invoiceNumber]);

  const review = useMemo(() => reviewDraft(draft, { erp: Boolean(target) }), [draft, target]);
  const blockers = [...view.serverBlockers, ...(erpDupes?.length ? [`Already in Business Central as ${erpDupes.map((d) => `${d.number} (${d.status})`).join(", ")}.`] : []), ...review.blockers];
  const warnings = [...view.serverWarnings, ...review.warnings];
  const lineSum = r2(draft.lines.reduce((s, l) => s + (l.net ?? 0), 0));
  const lineVat = r2(draft.lines.reduce((s, l) => s + (l.vat ?? 0), 0));

  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  const setLine = (i: number, patch: Partial<DraftLine>) => {
    setDraft((d) => {
      const lines = d.lines.map((l, j) => {
        if (j !== i) return l;
        const next = { ...l, ...patch };
        // Quantity or price changed: the line amount and its VAT follow.
        if (("qty" in patch || "unitPrice" in patch) && next.qty !== null && next.unitPrice !== null) next.net = r2(next.qty * next.unitPrice);
        if (("qty" in patch || "unitPrice" in patch || "vatRate" in patch || "net" in patch) && next.net !== null && next.vatRate !== null) next.vat = r2((next.net * next.vatRate) / 100);
        return next;
      });
      return { ...d, lines };
    });
    setDirty(true);
  };

  async function save(): Promise<boolean> {
    const res = await saveDraftAction(view.id, draft);
    if (res.error) {
      setError(res.error);
      return false;
    }
    setDirty(false);
    return true;
  }

  const onSave = () =>
    start(async () => {
      setError(null);
      if (await save()) router.refresh();
    });

  const onApprove = () =>
    start(async () => {
      setError(null);
      if (dirty && !(await save())) return;
      const res = await approveAction([view.id]);
      if (res.error) return setError(res.error);
      const r = res.results![0];
      if (!r.ok) setError(r.message ?? "Couldn't approve.");
      router.refresh();
    });

  const onUnapprove = () =>
    start(async () => {
      await unapproveAction(view.id);
      router.refresh();
    });

  const onPush = () =>
    start(async () => {
      const res = await pushAction([{ id: view.id, hash: view.hash }]);
      setPushing(false);
      if (res.error) return setError(res.error);
      setNotice({ title: res.results![0].ok ? "Pushed to Business Central." : "Not pushed.", results: res.results! });
      router.refresh();
    });

  const onDelete = () =>
    start(async () => {
      if (!confirm(`Delete the draft for ${draft.invoiceNumber || view.fileName}? The PDF is deleted too.`)) return;
      const res = await discardAction(view.id);
      if (res.error) return setError(res.error);
      router.push("/automation/purchase-invoices");
    });

  const erpValue = (l: DraftLine) => (l.erpType && l.erpNo ? `${l.erpType}:${l.erpNo}` : "");

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{draft.invoiceNumber || view.fileName}</h1>
        <StatusPill status={view.status} />
        {dirty && <span className="text-xs text-warn">Unsaved changes</span>}
      </div>
      <p className="mt-1 text-sm text-muted">
        {draft.supplierName || "Unknown supplier"} · read from {METHOD[view.source.method] ?? view.source.method}
        {view.source.ocr ? ` (${view.source.ocr.confidence}% confidence: check the figures against the scan)` : ""}
        {view.source.layout === "remembered" ? " · this supplier's layout was remembered" : view.source.layout === "learned" ? " · layout learned for next time" : ""}
      </p>

      {view.erp && (
        <p className="mt-4 rounded-lg bg-brand-soft px-4 py-3 text-sm">
          In Business Central as draft <strong>{view.erp.number}</strong> in {view.erp.company}, pushed {new Date(view.erp.pushedAt).toLocaleString()}.
          {view.erp.erpTotal !== null && draft.total !== null && Math.abs(view.erp.erpTotal - draft.total) > 0.01
            ? ` Business Central's total is ${money(view.erp.erpTotal)}, not ${money(draft.total)}: check the VAT setup on the draft there.`
            : " Post it in Business Central when you're ready."}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      {notice && (
        <div role="status" className="mt-4 rounded-lg border border-border px-4 py-3 text-sm">
          <p className="font-medium">{notice.title}</p>
          <ResultList results={notice.results} />
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* The supplier's document, scan or text, as uploaded. */}
        <section aria-label="Invoice PDF" className="lg:sticky lg:top-4 lg:self-start">
          <object data={`/api/automation/purchase-invoices/${view.id}/pdf#view=FitH`} type="application/pdf" className="h-[70vh] w-full rounded-xl border border-border bg-surface-muted lg:h-[calc(100dvh-8rem)]">
            <p className="p-4 text-sm">
              Your browser can&apos;t show the PDF here.{" "}
              <a className="underline" href={`/api/automation/purchase-invoices/${view.id}/pdf`} target="_blank" rel="noreferrer">
                Open it
              </a>
              .
            </p>
          </object>
          <a href={`/api/automation/purchase-invoices/${view.id}/pdf`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-muted hover:text-foreground">
            Open {view.fileName} in a new tab ↗
          </a>
        </section>

        <section aria-label="What Sawwi read" className="min-w-0 space-y-6">
          {/* What needs attention first. */}
          {(blockers.length > 0 || warnings.length > 0) && (
            <div className="space-y-2">
              {blockers.length > 0 && (
                <div className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm">
                  <p className="font-medium text-warn">To fix before approving</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}
              {warnings.length > 0 && (
                <ul className="space-y-0.5 rounded-lg border border-border px-4 py-3 text-sm text-muted">
                  {warnings.map((w) => (
                    <li key={w}>• {w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <fieldset disabled={locked} className="grid min-w-0 gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">Supplier and invoice</legend>
            <label className="text-xs text-muted">
              Supplier (as printed)
              <input className={input} value={draft.supplierName} onChange={(e) => set({ supplierName: e.target.value })} />
            </label>
            <label className="text-xs text-muted">
              Supplier TRN
              <input className={input} value={draft.supplierTrn} inputMode="numeric" onChange={(e) => set({ supplierTrn: e.target.value })} />
            </label>
            {target && (
              <label className="text-xs text-muted sm:col-span-2">
                Business Central vendor {draft.vendorNo && draft.vendorMatchedBy && <span className="text-success">({MATCHED_BY[draft.vendorMatchedBy]})</span>}
                <select
                  className={input}
                  value={draft.vendorNo}
                  onChange={(e) => {
                    const v = master?.vendors.find((x) => x.number === e.target.value);
                    set({ vendorNo: v?.number ?? "", vendorName: v?.name ?? "", vendorMatchedBy: v ? "user" : undefined });
                  }}
                >
                  <option value="">— Pick the vendor —</option>
                  {master?.vendors.map((v) => (
                    <option key={v.number} value={v.number}>
                      {v.number} · {v.name}
                      {v.trn ? ` · TRN ${v.trn}` : ""}
                    </option>
                  ))}
                </select>
                {!master && <span className="mt-1 block text-warn">Couldn&apos;t read vendors from Business Central. Refresh from the list page.</span>}
              </label>
            )}
            <label className="text-xs text-muted">
              Invoice number
              <input className={input} value={draft.invoiceNumber} onChange={(e) => set({ invoiceNumber: e.target.value })} />
            </label>
            <label className="text-xs text-muted">
              PO number
              <input className={input} value={draft.poNumber} onChange={(e) => set({ poNumber: e.target.value })} />
            </label>
            <label className="text-xs text-muted">
              Invoice date
              <input type="date" className={input} value={draft.invoiceDate} onChange={(e) => set({ invoiceDate: e.target.value })} />
            </label>
            <label className="text-xs text-muted">
              Due date
              <input type="date" className={input} value={draft.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
            </label>
            <label className="text-xs text-muted">
              Currency
              <input className={input} value={draft.currency} maxLength={3} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} />
            </label>
          </fieldset>

          <fieldset disabled={locked} className="min-w-0">
            <legend className="mb-2 text-sm font-semibold">Lines</legend>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[46rem] text-sm">
                <thead className="bg-surface-muted text-left text-xs text-muted">
                  <tr>
                    <th className="px-2 py-2 font-medium">Description · supplier SKU</th>
                    {target && <th className="px-2 py-2 font-medium">Item or G/L account</th>}
                    <th className="w-20 px-2 py-2 text-right font-medium">Qty</th>
                    <th className="w-24 px-2 py-2 text-right font-medium">Unit price</th>
                    <th className="w-16 px-2 py-2 text-right font-medium">VAT %</th>
                    <th className="w-24 px-2 py-2 text-right font-medium">Net</th>
                    <th className="w-20 px-2 py-2 text-right font-medium">VAT</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {draft.lines.map((l, i) => (
                    <tr key={i} className="border-t border-border align-top">
                      <td className="space-y-1 px-2 py-2">
                        <input aria-label={`Line ${i + 1} description`} className={cell} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                        <input aria-label={`Line ${i + 1} supplier SKU`} className={`${cell} text-xs text-muted`} placeholder="Supplier SKU" value={l.sku} onChange={(e) => setLine(i, { sku: e.target.value })} />
                      </td>
                      {target && (
                        <td className="px-2 py-2">
                          <select
                            aria-label={`Line ${i + 1} item or account`}
                            className={`${cell} ${erpValue(l) ? "" : "border-warn"}`}
                            value={erpValue(l)}
                            onChange={(e) => {
                              const [type, no] = e.target.value.split(":");
                              setLine(i, type ? { erpType: type as "item" | "account", erpNo: no, matchedBy: "user" } : { erpType: null, erpNo: "", matchedBy: undefined });
                            }}
                          >
                            <option value="">— Pick —</option>
                            <optgroup label="Items">
                              {master?.items.map((it) => (
                                <option key={it.number} value={`item:${it.number}`}>
                                  {it.number} · {it.name}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="G/L accounts">
                              {master?.accounts.map((a) => (
                                <option key={a.number} value={`account:${a.number}`}>
                                  {a.number} · {a.name}
                                </option>
                              ))}
                            </optgroup>
                          </select>
                          {l.erpNo && l.matchedBy && <span className="text-xs text-success">{MATCHED_BY[l.matchedBy]}</span>}
                        </td>
                      )}
                      <td className="px-2 py-2">
                        <NumberInput label={`Line ${i + 1} quantity`} value={l.qty} onChange={(n) => setLine(i, { qty: n })} />
                      </td>
                      <td className="px-2 py-2">
                        <NumberInput label={`Line ${i + 1} unit price`} value={l.unitPrice} onChange={(n) => setLine(i, { unitPrice: n })} />
                      </td>
                      <td className="px-2 py-2">
                        <NumberInput label={`Line ${i + 1} VAT rate`} value={l.vatRate} onChange={(n) => setLine(i, { vatRate: n })} />
                      </td>
                      <td className="px-2 py-2">
                        <NumberInput label={`Line ${i + 1} net`} value={l.net} onChange={(n) => setLine(i, { net: n })} />
                      </td>
                      <td className="px-2 py-2">
                        <NumberInput label={`Line ${i + 1} VAT`} value={l.vat} onChange={(n) => setLine(i, { vat: n })} />
                      </td>
                      <td className="px-1 py-2">
                        {!locked && (
                          <button type="button" className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-muted hover:text-danger" aria-label={`Remove line ${i + 1}`} onClick={() => set({ lines: draft.lines.filter((_, j) => j !== i) })}>
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-border text-xs text-muted">
                  <tr>
                    <td className="px-2 py-2" colSpan={target ? 5 : 4}>
                      {!locked && (
                        <button
                          type="button"
                          className="text-sm text-brand hover:underline"
                          onClick={() => set({ lines: [...draft.lines, { description: "", sku: "", qty: 1, unitPrice: null, net: null, vatRate: draft.lines[0]?.vatRate ?? null, vat: null, erpType: null, erpNo: "" }] })}
                        >
                          + Add line
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(lineSum)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(lineVat)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </fieldset>

          <fieldset disabled={locked} className="grid min-w-0 gap-3 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-semibold">Totals on the invoice</legend>
            <label className="text-xs text-muted">
              Net (excl. VAT)
              <NumberInput label="Invoice net" className={input} value={draft.subtotal} onChange={(n) => set({ subtotal: n })} />
            </label>
            <label className="text-xs text-muted">
              VAT
              <NumberInput label="Invoice VAT" className={input} value={draft.vat} onChange={(n) => set({ vat: n })} />
            </label>
            <label className="text-xs text-muted">
              Total
              <NumberInput label="Invoice total" className={input} value={draft.total} onChange={(n) => set({ total: n })} />
            </label>
          </fieldset>

          <div>
            <h2 className="text-sm font-semibold">Checks</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {review.checks.map((c) => (
                <li key={c.id} className={c.ok ? "text-success" : "text-danger"}>
                  {c.ok ? "✓" : "✕"} <span className="text-foreground">{c.label}:</span> {c.detail}
                </li>
              ))}
              {review.checks.length === 0 && <li className="text-muted">No totals to check yet.</li>}
            </ul>
          </div>

          {/* Actions. */}
          <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-2 border-t border-border bg-background/95 px-1 py-3 backdrop-blur">
            {canEdit && view.status !== "pushed" && view.status !== "pushing" && (
              <>
                {view.status !== "approved" || dirty ? (
                  <button type="button" className={buttonClass("primary")} onClick={onApprove} disabled={busy || blockers.length > 0} title={blockers[0]}>
                    {dirty ? "Save and approve" : "Approve"}
                  </button>
                ) : (
                  <>
                    {target && (
                      <button type="button" className={buttonClass("primary")} onClick={() => setPushing(true)} disabled={busy || blockers.length > 0}>
                        Push to Business Central
                      </button>
                    )}
                    <button type="button" className={buttonClass("secondary")} onClick={onUnapprove} disabled={busy}>
                      Withdraw approval
                    </button>
                  </>
                )}
                {dirty && (
                  <button type="button" className={buttonClass("secondary")} onClick={onSave} disabled={busy}>
                    Save
                  </button>
                )}
              </>
            )}
            <a href={`/api/automation/purchase-invoices/export?ids=${view.id}`} className={buttonClass("secondary")} aria-disabled={dirty} onClick={(e) => dirty && (e.preventDefault(), setError("Save your changes first, then download."))}>
              Download CSV
            </a>
            {view.approvedAt && view.status === "approved" && <span className="text-xs text-muted">Approved {new Date(view.approvedAt).toLocaleString()}</span>}
            {canEdit && view.status !== "pushed" && view.status !== "pushing" && (
              <button type="button" className="ml-auto text-sm text-muted hover:text-danger" onClick={onDelete} disabled={busy}>
                Delete draft
              </button>
            )}
            {view.status === "pushed" && (
              <Link href="/automation/purchase-invoices" className="ml-auto text-sm text-muted hover:text-foreground">
                Back to the list
              </Link>
            )}
          </div>
        </section>
      </div>

      <PushDialog open={pushing} target={target?.label ?? "Business Central"} items={[{ id: view.id, hash: view.hash, draft: view.draft }]} busy={busy} onCancel={() => setPushing(false)} onConfirm={onPush} />
    </div>
  );
}
