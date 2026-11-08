"use client";

import { useEffect, useRef } from "react";
import { buttonClass } from "@/components/ui";
import type { Draft } from "@/lib/automation/purchase-invoices/draft";

// Pieces shared by the review queue and the single-invoice review (D-66).

export type Status = "needs_review" | "ready" | "approved" | "pushing" | "pushed";

const STATUS: Record<Status, { label: string; className: string }> = {
  needs_review: { label: "Needs review", className: "bg-warn-soft text-warn" },
  ready: { label: "Ready to approve", className: "bg-info-soft text-info" },
  approved: { label: "Approved", className: "bg-success-soft text-success" },
  pushing: { label: "Sending…", className: "bg-surface-muted text-muted" },
  pushed: { label: "In ERP", className: "bg-brand-soft text-brand" },
};

export function StatusPill({ status }: { status: Status }) {
  const s = STATUS[status];
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>;
}

export const money = (n: number | null | undefined, ccy = "") =>
  n === null || n === undefined ? "—" : `${ccy ? `${ccy} ` : ""}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const MATCHED_BY: Record<string, string> = { memory: "remembered", trn: "by TRN", name: "by name", sku: "by SKU", gtin: "by GTIN", user: "picked" };

export type PushItem = { id: string; hash: string; draft: Draft };

/**
 * The explicit confirmation before anything is written to the ERP (D-64): it names the
 * company and every invoice, vendor and total, and the push carries each invoice's hash.
 */
export function PushDialog(props: { open: boolean; target: string; items: PushItem[]; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) d.showModal();
    if (!props.open && d.open) d.close();
  }, [props.open]);
  const total = props.items.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.draft.currency]: (acc[i.draft.currency] ?? 0) + (i.draft.total ?? 0) }), {});
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!props.busy) props.onCancel();
      }}
      className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/40"
    >
      <div className="p-5">
        <h2 className="text-base font-semibold">
          Push {props.items.length} purchase invoice{props.items.length === 1 ? "" : "s"} to Business Central?
        </h2>
        <p className="mt-1 text-sm text-muted">
          Each one is created as an <strong className="font-medium text-foreground">unposted draft</strong> in {props.target}. Nothing is posted; you post them in Business Central.
          Sawwi checks each against Business Central for duplicates first.
        </p>
        <div className="mt-4 max-h-72 overflow-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Vendor</th>
                <th className="px-3 py-2 font-medium">Invoice</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {props.items.map((i) => (
                <tr key={i.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    {i.draft.vendorName || i.draft.supplierName} <span className="text-xs text-muted">{i.draft.vendorNo}</span>
                  </td>
                  <td className="px-3 py-2">
                    {i.draft.invoiceNumber} <span className="text-xs text-muted">{i.draft.invoiceDate}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(i.draft.total, i.draft.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-right text-sm">
          Total: {Object.entries(total).map(([c, n]) => money(n, c)).join(" + ")}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={buttonClass("secondary")} onClick={props.onCancel} disabled={props.busy}>
            Cancel
          </button>
          <button type="button" className={buttonClass("primary")} onClick={props.onConfirm} disabled={props.busy} autoFocus>
            {props.busy ? "Pushing…" : `Push ${props.items.length} draft${props.items.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** Messages from a bulk approve or push: one line per invoice. */
export function ResultList({ results }: { results: { ok: boolean; message?: string }[] }) {
  const lines = results.filter((r) => r.message);
  if (!lines.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {lines.map((r, i) => (
        <li key={i} className={r.ok ? "text-success" : "text-danger"}>
          {r.ok ? "✓" : "✕"} {r.message}
        </li>
      ))}
    </ul>
  );
}
