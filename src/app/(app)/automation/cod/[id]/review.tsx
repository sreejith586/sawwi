"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConfirmPushDialog, money, ResultList, StatusPill, type Status } from "@/components/automation/shared";
import { buttonClass } from "@/components/ui";
import { approveRemittancesAction, discardRemittanceAction, pushRemittancesAction, saveRemittanceAction, unapproveRemittanceAction } from "@/app/actions/cod";
import { parcelKey, type ParcelAction, type RemittanceDraft, type RemittanceReview } from "@/lib/automation/cod/remittance";

// One COD batch (D-74): every parcel, the invoice it matched and what happens to its cash;
// the customer payments and journal it makes; approve, download, push.

type View = {
  id: string;
  courier: string;
  batchId: string;
  fileName: string;
  status: Status;
  draft: RemittanceDraft;
  review: RemittanceReview;
  hash: string;
  erp: { company: string; paymentJournal: string; generalJournal: string; payments: number; glLines: number; pushedAt: string } | null;
  approvedAt: string | null;
};

const ACTIONS: { id: ParcelAction; label: string }[] = [
  { id: "apply", label: "Apply to invoice" },
  { id: "on_account", label: "On account" },
  { id: "exclude", label: "Leave out" },
];
const STATE: Record<string, string> = { open: "open", paid: "already paid", none: "no invoice", unchecked: "not checked" };

export function RemittanceReviewPage({ view, target, canEdit }: { view: View; target: { label: string } | null; canEdit: boolean }) {
  const router = useRouter();
  const [actions, setActions] = useState<Record<string, ParcelAction | null>>(() => Object.fromEntries(view.draft.parcels.map((p) => [parcelKey(p), p.action])));
  const [postingDate, setPostingDate] = useState(view.draft.postingDate);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ title: string; results: { ok: boolean; message?: string }[] } | null>(null);
  const [pushing, setPushing] = useState(false);
  const [busy, start] = useTransition();
  const locked = !canEdit || view.status === "pushed" || view.status === "pushing";
  const ccy = view.draft.currency;
  const dirty = postingDate !== view.draft.postingDate || view.draft.parcels.some((p) => (actions[parcelKey(p)] ?? null) !== p.action);
  const r = view.review;

  async function save() {
    const res = await saveRemittanceAction(view.id, { actions, postingDate });
    if (res.error) {
      setError(res.error);
      return false;
    }
    return true;
  }
  const onApprove = () =>
    start(async () => {
      setError(null);
      if (dirty && !(await save())) return;
      const res = await approveRemittancesAction([view.id]);
      if (res.error) return setError(res.error);
      if (!res.results![0].ok) setError(res.results![0].message ?? "Couldn't approve.");
      router.refresh();
    });
  const onPush = () =>
    start(async () => {
      const res = await pushRemittancesAction([{ id: view.id, hash: view.hash }]);
      setPushing(false);
      if (res.error) return setError(res.error);
      setNotice({ title: res.results![0].ok ? "Added to Business Central." : "Not pushed.", results: res.results! });
      router.refresh();
    });
  const onDelete = () =>
    start(async () => {
      if (!confirm(`Delete ${view.courier} batch ${view.batchId} from Sawwi? Uploading the report again brings it back.`)) return;
      const res = await discardRemittanceAction(view.id);
      if (res.error) return setError(res.error);
      router.push("/automation/cod");
    });

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {view.courier} · {view.batchId}
        </h1>
        <StatusPill status={view.status} />
        {dirty && <span className="text-xs text-warn">Unsaved changes</span>}
      </div>
      <p className="mt-1 text-sm text-muted">
        {view.draft.parcels.length} parcels · collected {money(r.totals.collected, ccy)} · fees {money(r.totals.fees + r.totals.vat, ccy)} · remitted {money(r.totals.net, ccy)} · from {view.fileName}
      </p>

      {view.erp && (
        <p className="mt-4 rounded-lg bg-brand-soft px-4 py-3 text-sm">
          {view.erp.payments} customer payments in batch {view.erp.paymentJournal} and {view.erp.glLines} journal lines in {view.erp.generalJournal}, unposted, in {view.erp.company}, added{" "}
          {new Date(view.erp.pushedAt).toLocaleString()}. Post them in Business Central when you&apos;re ready.
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
      {view.status !== "pushed" && (r.blockers.length > 0 || r.warnings.length > 0) && (
        <div className="mt-4 space-y-2">
          {r.blockers.length > 0 && (
            <div className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm">
              <p className="font-medium text-warn">To fix before approving</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {r.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              {r.blockers.some((b) => b.startsWith("Choose the")) && (
                <p className="mt-1 text-xs">
                  Accounts and batches are set once under <Link href="/automation/cod" className="underline">Accounts and batches</Link>.
                </p>
              )}
            </div>
          )}
          {r.warnings.length > 0 && (
            <ul className="space-y-0.5 rounded-lg border border-border px-4 py-3 text-sm text-muted">
              {r.warnings.map((w) => (
                <li key={w}>• {w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <section className="mt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-semibold">Parcels</h2>
          <label className="text-xs text-muted">
            Posting date{" "}
            <input type="date" className="ml-1 h-8 rounded-md border border-border bg-surface px-2 text-sm" value={postingDate} disabled={locked} onChange={(e) => setPostingDate(e.target.value)} />
          </label>
        </div>
        <div className="mt-2 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[58rem] text-sm">
            <thead className="bg-surface-muted text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">AWB · order</th>
                <th className="px-3 py-2 font-medium">Invoice</th>
                <th className="px-3 py-2 text-right font-medium">Open</th>
                <th className="px-3 py-2 text-right font-medium">Collected</th>
                <th className="px-3 py-2 text-right font-medium">Fee + VAT</th>
                <th className="px-3 py-2 text-right font-medium">Net</th>
                <th className="w-44 px-3 py-2 font-medium">Cash goes</th>
              </tr>
            </thead>
            <tbody>
              {view.draft.parcels.map((p) => {
                const k = parcelKey(p);
                const flags = r.flags[k] ?? [];
                return (
                  <tr key={k} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      <p>{p.awb || "—"}</p>
                      <p className="text-xs text-muted">order {p.orderRef || "—"}</p>
                    </td>
                    <td className="px-3 py-2">
                      <p className={p.invoiceState === "open" ? "" : "text-warn"}>{p.invoiceNumber || STATE[p.invoiceState]}</p>
                      {p.invoiceNumber && <p className="text-xs text-muted">{STATE[p.invoiceState]}{p.customerNumber ? ` · ${p.customerNumber}` : ""}</p>}
                      {flags.map((f) => (
                        <p key={f} className="text-xs text-warn">
                          {f}
                        </p>
                      ))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.openAmount === null ? "—" : money(p.openAmount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(p.collected)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(p.fee + p.vat)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(p.net)}</td>
                    <td className="px-3 py-2">
                      <select
                        aria-label={`What happens to ${k}`}
                        className={`h-8 w-full rounded-md border bg-surface px-2 text-sm disabled:border-transparent disabled:bg-transparent ${actions[k] ? "border-border" : "border-warn"}`}
                        value={actions[k] ?? ""}
                        disabled={locked}
                        onChange={(e) => setActions({ ...actions, [k]: (e.target.value || null) as ParcelAction | null })}
                      >
                        <option value="">— Decide —</option>
                        {ACTIONS.map((a) => (
                          <option key={a.id} value={a.id} disabled={a.id === "apply" && Boolean(target) && p.invoiceState !== "open"}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {dirty && <p className="mt-2 text-xs text-warn">Save to see the payments and journal with your changes.</p>}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="min-w-0">
          <h2 className="text-sm font-semibold">Customer payments</h2>
          <div className="mt-2 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[26rem] text-sm">
              <thead className="bg-surface-muted text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Applied to</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {r.payments.map((p) => (
                  <tr key={p.awb || p.orderRef} className="border-t border-border">
                    <td className="px-3 py-2">{p.customerNumber || <span className="text-warn">—</span>}</td>
                    <td className="px-3 py-2">{p.invoiceNumber || <span className="text-muted">on account</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="min-w-0">
          <h2 className="text-sm font-semibold">Journal: bank, fees and clearing</h2>
          <div className="mt-2 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[26rem] text-sm">
              <thead className="bg-surface-muted text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 text-right font-medium">Debit</th>
                  <th className="px-3 py-2 text-right font-medium">Credit</th>
                </tr>
              </thead>
              <tbody>
                {r.gl.map((l) => (
                  <tr key={l.key} className="border-t border-border">
                    <td className="px-3 py-2">
                      <p className={l.account ? "" : "text-warn"}>{l.account ? `${l.account} · ${l.accountName || "—"}` : "No account chosen"}</p>
                      <p className="text-xs text-muted">{l.description}</p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.amount > 0 ? money(l.amount) : ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.amount < 0 ? money(-l.amount) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">The customer payments are balanced by the payment batch&apos;s balancing account, which should be courier clearing.</p>
          <ul className="mt-3 space-y-1 text-sm">
            {r.checks.map((c) => (
              <li key={c.id} className={c.ok ? "text-success" : "text-danger"}>
                {c.ok ? "✓" : "✕"} <span className="text-foreground">{c.label}:</span> {c.detail}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="sticky bottom-0 mt-6 flex flex-wrap items-center gap-2 border-t border-border bg-background/95 py-3 backdrop-blur">
        {canEdit && view.status !== "pushed" && view.status !== "pushing" && (
          <>
            {view.status !== "approved" || dirty ? (
              <button type="button" className={buttonClass("primary")} onClick={onApprove} disabled={busy || (!dirty && r.blockers.length > 0)}>
                {dirty ? "Save and approve" : "Approve"}
              </button>
            ) : (
              <>
                {target && (
                  <button type="button" className={buttonClass("primary")} onClick={() => setPushing(true)} disabled={busy}>
                    Push to Business Central
                  </button>
                )}
                <button type="button" className={buttonClass("secondary")} onClick={() => start(async () => void (await unapproveRemittanceAction(view.id), router.refresh()))} disabled={busy}>
                  Withdraw approval
                </button>
              </>
            )}
            {dirty && (
              <button type="button" className={buttonClass("secondary")} onClick={() => start(async () => void ((await save()) && router.refresh()))} disabled={busy}>
                Save
              </button>
            )}
          </>
        )}
        <a href={`/api/automation/cod/export?ids=${view.id}`} className={buttonClass("secondary")}>
          Download CSV
        </a>
        {view.approvedAt && view.status === "approved" && <span className="text-xs text-muted">Approved {new Date(view.approvedAt).toLocaleString()}</span>}
        {canEdit && view.status !== "pushed" && view.status !== "pushing" && (
          <button type="button" className="ml-auto text-sm text-muted hover:text-danger" onClick={onDelete} disabled={busy}>
            Delete
          </button>
        )}
      </div>

      <ConfirmPushDialog
        open={pushing}
        title="Add this COD remittance to Business Central?"
        body={
          <>
            {r.payments.length} customer payments and {r.gl.length} journal lines, <strong className="font-medium text-foreground">unposted</strong>, in {target?.label ?? "Business Central"}, dated{" "}
            {view.draft.postingDate}, document {view.batchId.slice(0, 20)}.
          </>
        }
        headers={["Customer / account", "Applied to / description", "Amount"]}
        rows={[
          ...r.payments.map((p) => ({ id: `p-${p.awb || p.orderRef}`, cells: [p.customerNumber, p.invoiceNumber || "on account", money(p.amount, ccy)] as [string, string, string] })),
          ...r.gl.map((l) => ({ id: `g-${l.key}`, cells: [`${l.account} ${l.accountName}`, l.description, money(l.amount, ccy)] as [string, string, string] })),
        ]}
        confirmLabel="Add payments and journal"
        busy={busy}
        onCancel={() => setPushing(false)}
        onConfirm={onPush}
      />
    </div>
  );
}
