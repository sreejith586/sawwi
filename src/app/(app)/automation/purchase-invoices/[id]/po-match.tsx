"use client";

import { track } from "@/lib/analytics/track";
import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui";
import { money } from "@/components/automation/shared";
import { orderLinesAction } from "@/app/actions/automation";
import { PRICE_TOLERANCE, type Draft } from "@/lib/automation/purchase-invoices/draft";
import { candidatesFor, grnOptionsFor, matchOrders, pickGrn, pickOrderLine } from "@/lib/automation/purchase-invoices/orders";
import type { ErpOpenOrderLine, ErpReceipt } from "@/lib/connectors/types";

// The three-way match on the review page (D-88, D-92): each invoice line beside the goods receipt
// (GRN) and purchase order line Sawwi suggested. Most supplier invoices print neither number, so
// Sawwi reads the vendor's recent GRNs and open orders and suggests; the user checks, changes a
// line's GRN or order line if needed, and confirms. "Link GRN" and "Link PO" pull one by number.

const EPS = 1e-9;
const grnKey = (g: { number: string; quantity: number }) => `${g.number}|${g.quantity}`;

export function PoMatch(props: {
  viewId: string;
  draft: Draft;
  lines: ErpOpenOrderLine[];
  receipts: ErpReceipt[];
  locked: boolean;
  onChange: (next: Draft) => void;
  onError: (message: string | null) => void;
}) {
  const { draft } = props;
  const [orderLines, setOrderLines] = useState(props.lines);
  const [receipts, setReceipts] = useState(props.receipts);
  const [poInput, setPoInput] = useState(draft.poNumber);
  const [grnInput, setGrnInput] = useState(draft.grnNumber ?? "");
  const [busy, start] = useTransition();
  const linked = draft.lines.filter((l) => l.po).length;
  const withGrn = draft.lines.filter((l) => l.grn).length;
  const byId = new Map(orderLines.map((o) => [o.lineId, o]));

  const merge = (more: ErpOpenOrderLine[], moreReceipts: ErpReceipt[]) => {
    const seen = new Set(orderLines.map((o) => o.lineId));
    const all = [...orderLines.map((o) => more.find((m) => m.lineId === o.lineId) ?? o), ...more.filter((m) => !seen.has(m.lineId))];
    const seenR = new Set(receipts.map((r) => r.id));
    const allR = [...receipts, ...moreReceipts.filter((r) => !seenR.has(r.id))];
    setOrderLines(all);
    setReceipts(allR);
    return { all, allR };
  };

  const pullPo = () =>
    start(async () => {
      props.onError(null);
      const no = poInput.trim();
      if (!no) return props.onError("Type the purchase order number from Business Central.");
      const res = await orderLinesAction(props.viewId, { orderNumber: no });
      track("invoice_link", { kind: "po", outcome: res.error ? "failed" : "ok" });
      if (res.error) return props.onError(res.error);
      const { all, allR } = merge(res.lines!, res.receipts ?? []);
      // Match against this PO only; the user confirms what it shows.
      props.onChange(matchOrders({ ...draft, poNumber: no, postTo: undefined, poConfirmed: undefined }, all, allR));
    });

  const pullGrn = () =>
    start(async () => {
      props.onError(null);
      const no = grnInput.trim();
      if (!no) return props.onError("Type the GRN (posted purchase receipt) number from Business Central.");
      const res = await orderLinesAction(props.viewId, { receiptNumber: no });
      track("invoice_link", { kind: "grn", outcome: res.error ? "failed" : "ok" });
      if (res.error) return props.onError(res.error);
      const { all, allR } = merge(res.lines!, res.receipts!);
      // Match against this GRN, and its order for the PO lines.
      props.onChange(matchOrders({ ...draft, grnNumber: no, postTo: undefined, poConfirmed: undefined }, all, allR));
    });

  const rematch = () =>
    start(async () => {
      props.onError(null);
      const res = await orderLinesAction(props.viewId);
      track("invoice_link", { kind: "rematch", outcome: res.error ? "failed" : "ok" });
      if (res.error) return props.onError(res.error);
      const { all, allR } = merge(res.lines!, res.receipts!);
      props.onChange(matchOrders({ ...draft, grnNumber: undefined, postTo: draft.postTo === "invoice" ? undefined : draft.postTo, poConfirmed: undefined }, all, allR));
    });

  const status = draft.postTo !== "order" ? null : draft.poConfirmed ? "confirmed" : linked ? "suggested" : null;
  const pullBox = (label: string, value: string, set: (v: string) => void, onPull: () => void, placeholder: string) => (
    <div className="flex items-end gap-2">
      <label className="text-xs text-muted">
        {label}
        <input
          className="mt-0.5 block h-9 w-36 rounded-lg border border-border bg-surface px-2.5 text-sm"
          placeholder={placeholder}
          value={value}
          onChange={(e) => set(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onPull())}
        />
      </label>
      <button type="button" className={buttonClass("secondary")} onClick={onPull} disabled={busy}>
        Pull
      </button>
    </div>
  );

  return (
    <section className="min-w-0 rounded-xl border border-border p-3 text-sm" aria-label="Purchase order and GRN match">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">GRN and purchase order</h2>
        {status === "confirmed" && <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">Match confirmed</span>}
        {status === "suggested" && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">Suggested: check and confirm</span>}
        {!linked && !withGrn && <span className="text-xs text-muted">No GRN or open purchase order line matches these lines.</span>}
      </div>
      <p className="mt-1 text-xs text-muted">
        {draft.grnNumber
          ? `Matched against GRN ${draft.grnNumber}${draft.poNumber ? ` and ${draft.poNumber}` : ""}.`
          : draft.poNumber
            ? `Matched against ${draft.poNumber}.`
            : "The invoice prints no PO or GRN number: Sawwi searched this vendor's GRNs from the last 180 days and its open purchase orders."}
      </p>

      {!props.locked && (
        <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
          {pullBox("Link GRN", grnInput, setGrnInput, pullGrn, "e.g. PRC-8002")}
          {pullBox("Link PO", poInput, setPoInput, pullPo, "e.g. PO-7002")}
          <button type="button" className="pb-2 text-xs text-muted underline hover:text-foreground" onClick={rematch} disabled={busy}>
            {busy ? "Reading Business Central…" : "Search all again"}
          </button>
        </div>
      )}

      {(linked > 0 || withGrn > 0) && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table data-clarity-mask="True" className="w-full min-w-[40rem] text-xs">
            <thead className="bg-surface-muted text-left text-muted">
              <tr>
                <th className="px-2 py-1.5 font-medium" colSpan={3}>
                  On the invoice
                </th>
                <th className="border-l border-border px-2 py-1.5 font-medium" colSpan={2}>
                  Goods receipt (GRN)
                </th>
                <th className="border-l border-border px-2 py-1.5 font-medium" colSpan={3}>
                  Purchase order
                </th>
                <th className="px-2 py-1.5 font-medium" />
              </tr>
              <tr>
                <th className="px-2 py-1 font-medium">Item</th>
                <th className="px-2 py-1 text-right font-medium">Qty</th>
                <th className="px-2 py-1 text-right font-medium">Price</th>
                <th className="border-l border-border px-2 py-1 font-medium">GRN</th>
                <th className="px-2 py-1 text-right font-medium">Received</th>
                <th className="border-l border-border px-2 py-1 font-medium">PO line</th>
                <th className="px-2 py-1 text-right font-medium">Open</th>
                <th className="px-2 py-1 text-right font-medium">PO price</th>
                <th className="px-2 py-1 font-medium">Match</th>
              </tr>
            </thead>
            <tbody>
              {draft.lines.map((l, i) => {
                const o = l.po ? byId.get(l.po.lineId) : undefined;
                const poOptions = l.erpType === "item" && l.erpNo ? candidatesFor(l.erpNo, orderLines) : [];
                if (l.po && !poOptions.some((x) => x.lineId === l.po!.lineId) && o) poOptions.unshift(o);
                const grnOptions = l.erpType === "item" && l.erpNo ? grnOptionsFor(l.erpNo, receipts) : [];
                if (l.grn && !grnOptions.some((g) => grnKey(g) === grnKey(l.grn!))) grnOptions.unshift(l.grn);
                const over = l.po && l.qty !== null && l.qty > l.po.open + EPS;
                const grnOff = l.grn && l.qty !== null && Math.abs(l.qty - l.grn.quantity) > EPS;
                const wrongOrder = l.grn && l.po && l.grn.orderNumber && l.grn.orderNumber !== l.po.orderNumber;
                const priceOff = l.po && l.unitPrice !== null && l.po.poPrice > 0 && Math.abs(l.unitPrice - l.po.poPrice) > l.po.poPrice * PRICE_TOLERANCE;
                const select = "h-7 w-full min-w-28 max-w-40 rounded-md border border-border bg-surface px-1 text-xs disabled:border-transparent disabled:bg-transparent";
                return (
                  <tr key={i} className={`border-t border-border align-top ${!l.po || wrongOrder || over ? "bg-danger-soft/40" : priceOff || grnOff ? "bg-warn-soft/40" : ""}`}>
                    <td className="px-2 py-1.5">
                      <span className="font-medium">{l.erpNo || "—"}</span>
                      <span className="block max-w-44 truncate text-muted" title={l.description}>
                        {l.sku || l.description}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{l.qty ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(l.unitPrice)}</td>
                    <td className="border-l border-border px-2 py-1.5">
                      <select
                        aria-label={`Line ${i + 1} GRN`}
                        className={select}
                        value={l.grn ? grnKey(l.grn) : ""}
                        disabled={props.locked || grnOptions.length === 0}
                        onChange={(e) => props.onChange(pickGrn(draft, i, grnOptions.find((g) => grnKey(g) === e.target.value) ?? null, orderLines))}
                      >
                        <option value="">{grnOptions.length ? "— No GRN —" : "No GRN found"}</option>
                        {grnOptions.map((g) => (
                          <option key={grnKey(g)} value={grnKey(g)}>
                            {g.number} · {g.postingDate} · {g.orderNumber}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{l.grn ? l.grn.quantity : "—"}</td>
                    <td className="border-l border-border px-2 py-1.5">
                      <select
                        aria-label={`Line ${i + 1} purchase order line`}
                        className={select}
                        title={o ? `${o.orderNumber}: ordered ${o.quantity}, received ${o.received}, invoiced ${o.invoiced}` : undefined}
                        value={l.po?.lineId ?? ""}
                        disabled={props.locked || poOptions.length === 0}
                        onChange={(e) => props.onChange(pickOrderLine(draft, i, orderLines.find((x) => x.lineId === e.target.value) ?? null))}
                      >
                        <option value="">{poOptions.length ? "— Not on a PO —" : "No open PO line"}</option>
                        {poOptions.map((x) => (
                          <option key={x.lineId} value={x.lineId}>
                            {x.orderNumber} · {x.orderDate}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{l.po ? l.po.open : "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{l.po ? money(l.po.poPrice) : "—"}</td>
                    <td className="px-2 py-1.5">
                      {!l.po ? (
                        <span className="text-warn">No PO line</span>
                      ) : wrongOrder ? (
                        <span className="text-danger">GRN on another PO</span>
                      ) : over ? (
                        <span className="text-danger">More than received</span>
                      ) : priceOff ? (
                        <span className="text-warn">Price differs</span>
                      ) : grnOff ? (
                        <span className="text-warn">Qty differs from GRN</span>
                      ) : !l.grn ? (
                        <span className="text-muted">✓ no GRN picked</span>
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
      <p className="mt-2 text-xs text-muted">
        Business Central invoices the order&apos;s received, not-yet-invoiced quantity; the GRN shown is the three-way check and audit trail.
      </p>

      {!props.locked && (
        <div className="mt-3 space-y-2">
          {linked > 0 && draft.postTo === "order" && !draft.poConfirmed && (
            <button type="button" className={buttonClass("primary")} onClick={() => {
                track("invoice_match_confirm");
                props.onChange({ ...draft, poConfirmed: true });
              }} disabled={busy}>
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
