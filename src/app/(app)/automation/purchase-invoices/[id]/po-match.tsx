"use client";

import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui";
import { money } from "@/components/automation/shared";
import { orderLinesAction } from "@/app/actions/automation";
import { PRICE_TOLERANCE, type Draft } from "@/lib/automation/purchase-invoices/draft";
import { candidatesFor, matchOrders, pickOrderLine } from "@/lib/automation/purchase-invoices/orders";
import type { ErpOpenOrderLine } from "@/lib/connectors/types";

// The three-way match on the review page (D-88): each invoice line beside the purchase order line
// and GRN Sawwi suggested. Most supplier invoices print no PO number, so Sawwi searches all the
// vendor's open orders and suggests; the user checks, changes a line's order line if needed, and
// confirms. "Link PO" pulls one PO by number from Business Central on demand.

const EPS = 1e-9;

export function PoMatch(props: {
  viewId: string;
  draft: Draft;
  lines: ErpOpenOrderLine[];
  locked: boolean;
  onChange: (next: Draft) => void;
  onError: (message: string | null) => void;
}) {
  const { draft } = props;
  const [orderLines, setOrderLines] = useState(props.lines);
  const [poInput, setPoInput] = useState(draft.poNumber);
  const [busy, start] = useTransition();
  const linked = draft.lines.filter((l) => l.po).length;
  const byId = new Map(orderLines.map((o) => [o.lineId, o]));

  const merge = (more: ErpOpenOrderLine[]) => {
    const seen = new Set(orderLines.map((o) => o.lineId));
    const all = [...orderLines.map((o) => more.find((m) => m.lineId === o.lineId) ?? o), ...more.filter((m) => !seen.has(m.lineId))];
    setOrderLines(all);
    return all;
  };

  const pull = () =>
    start(async () => {
      props.onError(null);
      const no = poInput.trim();
      if (!no) return props.onError("Type the purchase order number from Business Central.");
      const res = await orderLinesAction(props.viewId, no);
      if (res.error) return props.onError(res.error);
      const all = merge(res.lines!);
      // Match against this PO only; the user confirms what it shows.
      props.onChange(matchOrders({ ...draft, poNumber: no, postTo: undefined, poConfirmed: undefined }, all));
    });

  const rematch = () =>
    start(async () => {
      props.onError(null);
      const res = await orderLinesAction(props.viewId);
      if (res.error) return props.onError(res.error);
      const all = merge(res.lines!);
      props.onChange(matchOrders({ ...draft, postTo: draft.postTo === "invoice" ? undefined : draft.postTo, poConfirmed: undefined }, all));
    });

  const status = draft.postTo !== "order" ? null : draft.poConfirmed ? "confirmed" : linked ? "suggested" : null;

  return (
    <section className="min-w-0 rounded-xl border border-border p-3 text-sm" aria-label="Purchase order match">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Purchase order and GRN</h2>
        {status === "confirmed" && <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">Match confirmed</span>}
        {status === "suggested" && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">Suggested: check and confirm</span>}
        {!linked && <span className="text-xs text-muted">No open purchase order line with goods received matches these lines.</span>}
      </div>
      <p className="mt-1 text-xs text-muted">
        {draft.poNumber
          ? `Matched against ${draft.poNumber}, from the invoice or linked here.`
          : "The invoice prints no PO number: Sawwi searched this vendor's open purchase orders for lines with goods received and not yet invoiced."}
      </p>

      {!props.locked && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">
            Link PO
            <input
              className="mt-0.5 block h-9 w-40 rounded-lg border border-border bg-surface px-2.5 text-sm"
              placeholder="e.g. PO-7002"
              value={poInput}
              onChange={(e) => setPoInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), pull())}
            />
          </label>
          <button type="button" className={buttonClass("secondary")} onClick={pull} disabled={busy}>
            {busy ? "Reading Business Central…" : "Pull from Business Central"}
          </button>
          <button type="button" className="text-xs text-muted underline hover:text-foreground" onClick={rematch} disabled={busy}>
            Search all open POs again
          </button>
        </div>
      )}

      {linked > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[44rem] text-xs">
            <thead className="bg-surface-muted text-left text-muted">
              <tr>
                <th className="px-2 py-1.5 font-medium" colSpan={3}>
                  On the invoice
                </th>
                <th className="border-l border-border px-2 py-1.5 font-medium" colSpan={4}>
                  In Business Central
                </th>
                <th className="px-2 py-1.5 font-medium" />
              </tr>
              <tr>
                <th className="px-2 py-1 font-medium">Item</th>
                <th className="px-2 py-1 text-right font-medium">Qty</th>
                <th className="px-2 py-1 text-right font-medium">Price</th>
                <th className="border-l border-border px-2 py-1 font-medium">PO line · GRN</th>
                <th className="px-2 py-1 text-right font-medium">Ordered / received / invoiced</th>
                <th className="px-2 py-1 text-right font-medium">Open</th>
                <th className="px-2 py-1 text-right font-medium">PO price</th>
                <th className="px-2 py-1 font-medium">Match</th>
              </tr>
            </thead>
            <tbody>
              {draft.lines.map((l, i) => {
                const o = l.po ? byId.get(l.po.lineId) : undefined;
                const options = l.erpType === "item" && l.erpNo ? candidatesFor(l.erpNo, orderLines) : [];
                if (l.po && !options.some((x) => x.lineId === l.po!.lineId) && o) options.unshift(o);
                const over = l.po && l.qty !== null && l.qty > l.po.open + EPS;
                const priceOff = l.po && l.unitPrice !== null && l.po.poPrice > 0 && Math.abs(l.unitPrice - l.po.poPrice) > l.po.poPrice * PRICE_TOLERANCE;
                return (
                  <tr key={i} className="border-t border-border align-top">
                    <td className="px-2 py-1.5">
                      <span className="font-medium">{l.erpNo || "—"}</span>
                      <span className="block max-w-48 truncate text-muted" title={l.description}>
                        {l.sku || l.description}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{l.qty ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(l.unitPrice)}</td>
                    <td className="border-l border-border px-2 py-1.5">
                      <select
                        aria-label={`Line ${i + 1} purchase order line`}
                        className="h-7 max-w-56 rounded-md border border-border bg-surface px-1 text-xs disabled:border-transparent disabled:bg-transparent"
                        value={l.po?.lineId ?? ""}
                        disabled={props.locked || options.length === 0}
                        onChange={(e) => props.onChange(pickOrderLine(draft, i, orderLines.find((x) => x.lineId === e.target.value) ?? null))}
                      >
                        <option value="">{options.length ? "— Not on a PO —" : "No open PO line"}</option>
                        {options.map((x) => (
                          <option key={x.lineId} value={x.lineId}>
                            {x.orderNumber} · {x.orderDate}
                            {x.receipts.length ? ` · GRN ${x.receipts.join(", ")}` : " · no GRN"}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{o ? `${o.quantity} / ${o.received} / ${o.invoiced}` : "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{l.po ? l.po.open : "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{l.po ? money(l.po.poPrice) : "—"}</td>
                    <td className="px-2 py-1.5">
                      {!l.po ? (
                        <span className="text-warn">Not matched</span>
                      ) : over ? (
                        <span className="text-danger">More than received</span>
                      ) : priceOff ? (
                        <span className="text-warn">Price differs</span>
                      ) : (
                        <span className="text-success">✓</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!props.locked && (
        <div className="mt-3 space-y-2">
          {linked > 0 && draft.postTo === "order" && !draft.poConfirmed && (
            <button type="button" className={buttonClass("primary")} onClick={() => props.onChange({ ...draft, poConfirmed: true })} disabled={busy}>
              Confirm this match
            </button>
          )}
          <fieldset className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
            <legend className="sr-only">Post to</legend>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="postTo" checked={draft.postTo === "order"} onChange={() => props.onChange({ ...draft, postTo: "order" })} disabled={!linked} />
              Post against the purchase order
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="postTo" checked={draft.postTo !== "order"} onChange={() => props.onChange({ ...draft, postTo: "invoice", poConfirmed: undefined })} />
              Standalone purchase invoice (not on a PO)
            </label>
          </fieldset>
        </div>
      )}
    </section>
  );
}
