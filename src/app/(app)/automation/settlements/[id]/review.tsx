"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConfirmPushDialog, money, ResultList, StatusPill, type Status } from "@/components/automation/shared";
import { buttonClass } from "@/components/ui";
import { approveSettlementsAction, discardSettlementAction, pushSettlementsAction, saveSettlementAction, unapproveSettlementAction } from "@/app/actions/settlements";
import type { JournalReview, SettlementDraft } from "@/lib/automation/settlements/journal";

// One settlement (D-70): each amount type and where it goes, the journal it makes, its checks;
// classify, approve, download, push.

type View = {
  id: string;
  marketplace: string;
  settlementId: string;
  fileName: string;
  status: Status;
  draft: SettlementDraft;
  journal: JournalReview;
  hash: string;
  erp: { company: string; journal: string; lines: number; pushedAt: string } | null;
  approvedAt: string | null;
};

const BY: Record<string, string> = { dictionary: "recognised", memory: "remembered", user: "your choice" };

export function SettlementReview({ view, buckets, target, canEdit }: { view: View; buckets: { id: string; label: string; hint: string }[]; target: { label: string } | null; canEdit: boolean }) {
  const router = useRouter();
  const [choice, setChoice] = useState<Record<string, string | null>>(() => Object.fromEntries(view.draft.categories.map((c) => [c.key, c.bucket])));
  const [postingDate, setPostingDate] = useState(view.draft.postingDate);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ title: string; results: { ok: boolean; message?: string }[] } | null>(null);
  const [pushing, setPushing] = useState(false);
  const [busy, start] = useTransition();
  const locked = !canEdit || view.status === "pushed" || view.status === "pushing";
  const ccy = view.draft.currency;
  const dirty = postingDate !== view.draft.postingDate || view.draft.categories.some((c) => (choice[c.key] ?? null) !== c.bucket);

  async function save() {
    const res = await saveSettlementAction(view.id, { buckets: choice, postingDate });
    if (res.error) {
      setError(res.error);
      return false;
    }
    return true;
  }
  const onSave = () => start(async () => void ((await save()) && router.refresh()));
  const onApprove = () =>
    start(async () => {
      setError(null);
      if (dirty && !(await save())) return;
      const res = await approveSettlementsAction([view.id]);
      if (res.error) return setError(res.error);
      if (!res.results![0].ok) setError(res.results![0].message ?? "Couldn't approve.");
      router.refresh();
    });
  const onPush = () =>
    start(async () => {
      const res = await pushSettlementsAction([{ id: view.id, hash: view.hash }]);
      setPushing(false);
      if (res.error) return setError(res.error);
      setNotice({ title: res.results![0].ok ? "Added to Business Central." : "Not pushed.", results: res.results! });
      router.refresh();
    });
  const onDelete = () =>
    start(async () => {
      if (!confirm(`Delete settlement ${view.settlementId} from Sawwi? Uploading the report again brings it back.`)) return;
      const res = await discardSettlementAction(view.id);
      if (res.error) return setError(res.error);
      router.push("/automation/settlements");
    });

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {view.marketplace} · {view.settlementId}
        </h1>
        <StatusPill status={view.status} />
        {dirty && <span className="text-xs text-warn">Unsaved changes</span>}
      </div>
      <p className="mt-1 text-sm text-muted">
        {view.draft.periodStart && view.draft.periodEnd ? `${view.draft.periodStart} to ${view.draft.periodEnd}` : ""} · {view.draft.rows} rows
        {view.draft.orders ? `, ${view.draft.orders} orders` : ""} · from {view.fileName}
      </p>

      {view.erp && (
        <p className="mt-4 rounded-lg bg-brand-soft px-4 py-3 text-sm">
          {view.erp.lines} unposted lines in {view.erp.company}, batch {view.erp.journal}, added {new Date(view.erp.pushedAt).toLocaleString()}. Post them in Business Central when you&apos;re ready.
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
      {(view.journal.blockers.length > 0 || view.journal.warnings.length > 0) && view.status !== "pushed" && (
        <div className="mt-4 space-y-2">
          {view.journal.blockers.length > 0 && (
            <div className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm">
              <p className="font-medium text-warn">To fix before approving</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {view.journal.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              {view.journal.blockers.some((b) => b.startsWith("Choose the")) && (
                <p className="mt-1 text-xs">
                  Accounts are set once for all settlements under <Link href="/automation/settlements" className="underline">Accounts and posting</Link>.
                </p>
              )}
            </div>
          )}
          {view.journal.warnings.length > 0 && (
            <ul className="space-y-0.5 rounded-lg border border-border px-4 py-3 text-sm text-muted">
              {view.journal.warnings.map((w) => (
                <li key={w}>• {w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="min-w-0">
          <h2 className="text-sm font-semibold">Amount types in the report</h2>
          <div className="mt-2 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[28rem] text-sm">
              <thead className="bg-surface-muted text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">As the marketplace names it</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="w-52 px-3 py-2 font-medium">Goes to</th>
                </tr>
              </thead>
              <tbody>
                {view.draft.categories.map((c) => (
                  <tr key={c.key} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      <p>{c.key}</p>
                      <p className="text-xs text-muted">
                        {c.rows} row{c.rows === 1 ? "" : "s"}
                        {c.classifiedBy && (choice[c.key] ?? null) === c.bucket ? ` · ${BY[c.classifiedBy]}` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(c.amount)}</td>
                    <td className="px-3 py-2">
                      <select
                        aria-label={`Where ${c.key} goes`}
                        className={`h-8 w-full rounded-md border bg-surface px-2 text-sm disabled:border-transparent disabled:bg-transparent ${choice[c.key] ? "border-border" : "border-warn"}`}
                        value={choice[c.key] ?? ""}
                        disabled={locked}
                        onChange={(e) => setChoice({ ...choice, [c.key]: e.target.value || null })}
                      >
                        <option value="">— Classify —</option>
                        {buckets.map((b) => (
                          <option key={b.id} value={b.id} title={b.hint}>
                            {b.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border text-sm">
                <tr>
                  <td className="px-3 py-2 text-muted">Payout{view.draft.statedPayout === null ? " (sum of the amounts)" : " stated in the report"}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{money(view.journal.payout, ccy)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">A category you classify is remembered for {view.marketplace} and used for its other settlements.</p>
        </section>

        <section className="min-w-0">
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-sm font-semibold">Journal entry</h2>
            <label className="text-xs text-muted">
              Posting date{" "}
              <input type="date" className="ml-1 h-8 rounded-md border border-border bg-surface px-2 text-sm" value={postingDate} disabled={locked} onChange={(e) => setPostingDate(e.target.value)} />
            </label>
          </div>
          <div className="mt-2 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[28rem] text-sm">
              <thead className="bg-surface-muted text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 text-right font-medium">Debit</th>
                  <th className="px-3 py-2 text-right font-medium">Credit</th>
                </tr>
              </thead>
              <tbody>
                {view.journal.lines.map((l) => (
                  <tr key={l.bucket} className="border-t border-border">
                    <td className="px-3 py-2">
                      <p className={l.account ? "" : "text-warn"}>{l.account ? `${l.account} · ${l.accountName || "—"}` : "No account chosen"}</p>
                      <p className="text-xs text-muted">{l.description}</p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.amount > 0 ? money(l.amount) : ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.amount < 0 ? money(-l.amount) : ""}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border font-medium">
                <tr>
                  <td className="px-3 py-2">Total {ccy}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(view.journal.debits)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(view.journal.credits)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {dirty && <p className="mt-2 text-xs text-warn">Save to see the journal with your changes.</p>}
          <ul className="mt-3 space-y-1 text-sm">
            {view.journal.checks.map((c) => (
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
              <button type="button" className={buttonClass("primary")} onClick={onApprove} disabled={busy || (!dirty && view.journal.blockers.length > 0)}>
                {dirty ? "Save and approve" : "Approve"}
              </button>
            ) : (
              <>
                {target && (
                  <button type="button" className={buttonClass("primary")} onClick={() => setPushing(true)} disabled={busy}>
                    Push to Business Central
                  </button>
                )}
                <button type="button" className={buttonClass("secondary")} onClick={() => start(async () => void (await unapproveSettlementAction(view.id), router.refresh()))} disabled={busy}>
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
        <a href={`/api/automation/settlements/export?ids=${view.id}`} className={buttonClass("secondary")}>
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
        title="Add this settlement journal to Business Central?"
        body={
          <>
            {view.journal.lines.length} lines go into the batch <strong className="font-medium text-foreground">unposted</strong>, in {target?.label ?? "Business Central"}, dated{" "}
            {view.draft.postingDate}, document {view.settlementId.slice(0, 20)}.
          </>
        }
        headers={["Account", "Description", "Amount"]}
        rows={view.journal.lines.map((l) => ({ id: l.bucket, cells: [`${l.account} ${l.accountName}`, l.description, money(l.amount, ccy)] }))}
        footer={`Debits ${money(view.journal.debits, ccy)} = credits ${money(view.journal.credits, ccy)}`}
        confirmLabel="Add the journal"
        busy={busy}
        onCancel={() => setPushing(false)}
        onConfirm={onPush}
      />
    </div>
  );
}
