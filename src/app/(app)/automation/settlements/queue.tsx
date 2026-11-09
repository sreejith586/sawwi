"use client";

import { uploadPresigned as uploadToBlob } from "@vercel/blob/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { ConfirmPushDialog, money, ResultList, StatusPill, type Status } from "@/components/automation/shared";
import { buttonClass } from "@/components/ui";
import {
  approveSettlementsAction,
  captureSettlementSampleAction,
  pushSettlementsAction,
  refreshSettlementErpAction,
  updateSettlementSettingsAction,
} from "@/app/actions/settlements";

// The settlement queue (D-70): every settlement's figures and checks, single and bulk approve,
// CSV, push; and the account mapping each journal uses.

export type SettlementRow = {
  id: string;
  marketplace: string;
  settlementId: string;
  fileName: string;
  status: Status;
  periodStart: string;
  periodEnd: string;
  postingDate: string;
  currency: string;
  payout: number;
  categories: number;
  unclassified: number;
  lines: number;
  checksOk: boolean;
  blockers: string[];
  hash: string;
  erp: string | null;
};

type Erp = { company: string; lcy: string; accounts: { number: string; name: string }[]; journals: { id: string; code: string; name: string }[]; fetchedAt: string };
type Settings = { accounts: Record<string, string | undefined>; salesVatRate: number | null; journalId: string | null; accountNames: Record<string, string> };

type Props = {
  rows: SettlementRow[];
  canEdit: boolean;
  demo: boolean;
  samples: { id: string; title: string; shows: string }[];
  directUploads: boolean;
  incomingFolder: string;
  targets: { connectionId: string; label: string }[];
  target: { connectionId: string; label: string } | null;
  settings: Settings;
  buckets: { id: string; label: string; hint: string; used: boolean }[];
  erp: Erp | null;
};

const FILTERS = [
  { id: "open", label: "To review" },
  { id: "approved", label: "Approved" },
  { id: "pushed", label: "In ERP" },
  { id: "all", label: "All" },
] as const;
const ACCEPT = ".csv,.tsv,.txt,.xlsx,.pdf";
const input = "h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm";

function AccountsPanel(props: Pick<Props, "settings" | "buckets" | "erp" | "canEdit" | "target" | "targets">) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Record<string, string>>(() => Object.fromEntries(props.buckets.map((b) => [b.id, props.settings.accounts[b.id] ?? ""])));
  const [vat, setVat] = useState(props.settings.salesVatRate ? String(props.settings.salesVatRate) : "");
  const [journalId, setJournalId] = useState(props.settings.journalId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, start] = useTransition();
  const missing = props.buckets.filter((b) => b.used && !props.settings.accounts[b.id]).length;
  const [open, setOpen] = useState(missing > 0);

  const save = () =>
    start(async () => {
      setError(null);
      const res = await updateSettlementSettingsAction({ accounts, salesVatRate: vat || null, journalId: journalId || null });
      if (res.error) return setError(res.error);
      setSaved(true);
      router.refresh();
    });
  const setTarget = (value: string) =>
    start(async () => {
      const res = await updateSettlementSettingsAction({ target: value || "" });
      if (res.error) setError(res.error);
      router.refresh();
    });
  const refreshErp = () =>
    start(async () => {
      const res = await refreshSettlementErpAction();
      if (res.error) setError(res.error);
      router.refresh();
    });

  return (
    <section className="rounded-xl border border-border bg-surface">
      <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="font-medium">Accounts and posting</span>
        <span className={`text-xs ${missing ? "text-warn" : "text-muted"}`}>
          {missing ? `${missing} account${missing === 1 ? "" : "s"} to choose` : `${props.target ? props.target.label : "CSV only"}${props.settings.salesVatRate ? ` · output VAT split at ${props.settings.salesVatRate}%` : ""}`}
        </span>
        <span className="ml-auto text-muted">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <fieldset disabled={!props.canEdit || busy} className="min-w-0 space-y-4 border-t border-border px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-muted">
              Push to
              <select className={input} value={props.target?.connectionId ?? ""} onChange={(e) => setTarget(e.target.value)}>
                <option value="">No ERP: CSV download only</option>
                {props.targets.map((t) => (
                  <option key={t.connectionId} value={t.connectionId}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            {props.target && (
              <label className="text-xs text-muted">
                Journal batch {props.erp && <span>(read {new Date(props.erp.fetchedAt).toLocaleString()})</span>}
                <div className="flex gap-2">
                  <select className={input} value={journalId} onChange={(e) => setJournalId(e.target.value)}>
                    <option value="">— Pick a batch —</option>
                    {props.erp?.journals.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.code} · {j.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" className={buttonClass("secondary")} onClick={refreshErp} title="Read accounts and journal batches from Business Central again">
                    Refresh
                  </button>
                </div>
              </label>
            )}
          </div>
          {props.targets.length === 0 && (
            <p className="text-xs text-muted">
              To push, <Link href="/settings/connections" className="underline">connect Business Central</Link>. Without it, type your account numbers and download CSV.
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="bg-surface-muted text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Amounts</th>
                  <th className="w-72 px-3 py-2 font-medium">G/L account</th>
                </tr>
              </thead>
              <tbody>
                {props.buckets.map((b) => (
                  <tr key={b.id} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      <p className={b.used ? "font-medium" : "text-muted"}>{b.label}</p>
                      <p className="text-xs text-muted">{b.hint}</p>
                    </td>
                    <td className="px-3 py-2">
                      {props.erp ? (
                        <select aria-label={`Account for ${b.label}`} className={`${input} ${b.used && !accounts[b.id] ? "border-warn" : ""}`} value={accounts[b.id] ?? ""} onChange={(e) => setAccounts({ ...accounts, [b.id]: e.target.value })}>
                          <option value="">—</option>
                          {props.erp.accounts.map((a) => (
                            <option key={a.number} value={a.number}>
                              {a.number} · {a.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input aria-label={`Account for ${b.label}`} className={`${input} ${b.used && !accounts[b.id] ? "border-warn" : ""}`} placeholder="Account no." value={accounts[b.id] ?? ""} onChange={(e) => setAccounts({ ...accounts, [b.id]: e.target.value })} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label className="flex flex-wrap items-center gap-2 text-sm">
            <input type="checkbox" checked={Boolean(vat)} onChange={(e) => setVat(e.target.checked ? "5" : "")} />
            Sales include VAT: split output VAT out of sales, shipping, promotions and refunds at
            <input className="h-8 w-16 rounded-md border border-border bg-surface px-2 text-right text-sm" inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value)} disabled={!vat} aria-label="Sales VAT rate" />%
          </label>
          <p className="text-xs text-muted">Leave it off if you map Sales to a marketplace receivable because your ERP already invoices these sales with their VAT.</p>

          {error && <p className="text-sm text-danger">{error}</p>}
          {props.canEdit && (
            <div className="flex items-center gap-3">
              <button type="button" className={buttonClass("primary")} onClick={save}>
                Save accounts
              </button>
              {saved && !busy && <span className="text-xs text-success">Saved. Drafts updated.</span>}
            </div>
          )}
        </fieldset>
      )}
    </section>
  );
}

export function SettlementQueue(props: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("open");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ title: string; results: { ok: boolean; message?: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [pushing, setPushing] = useState<string[] | null>(null);
  const [busy, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { open: 0, approved: 0, pushed: 0, all: props.rows.length };
    for (const r of props.rows) {
      if (r.status === "needs_review" || r.status === "ready" || r.status === "pushing") c.open++;
      if (r.status === "approved") c.approved++;
      if (r.status === "pushed") c.pushed++;
    }
    return c;
  }, [props.rows]);
  const shown = props.rows.filter((r) => (filter === "all" ? true : filter === "open" ? ["needs_review", "ready", "pushing"].includes(r.status) : r.status === filter));
  const picked = props.rows.filter((r) => selected.has(r.id));
  const approvable = picked.filter((r) => (r.status === "ready" || r.status === "needs_review") && r.blockers.length === 0);
  const pushable = picked.filter((r) => r.status === "approved");
  const allPicked = shown.length > 0 && shown.every((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));

  const approve = (ids: string[]) =>
    start(async () => {
      setError(null);
      const res = await approveSettlementsAction(ids);
      if (res.error) return setError(res.error);
      setNotice({ title: `${res.results!.filter((r) => r.ok).length} of ${ids.length} approved.`, results: res.results! });
      setSelected(new Set());
      router.refresh();
    });
  const push = () =>
    start(async () => {
      const items = props.rows.filter((r) => pushing?.includes(r.id)).map((r) => ({ id: r.id, hash: r.hash }));
      const res = await pushSettlementsAction(items);
      setPushing(null);
      if (res.error) return setError(res.error);
      setNotice({ title: `${res.results!.filter((r) => r.ok).length} of ${items.length} added to Business Central, unposted.`, results: res.results! });
      setSelected(new Set());
      router.refresh();
    });
  const sample = (id: string) =>
    start(async () => {
      setError(null);
      const res = await captureSettlementSampleAction(id);
      if (res.error) return setError(res.error);
      const fresh = res.results!.filter((r) => !r.existing).length;
      setNotice({ title: fresh ? `${fresh} settlement${fresh === 1 ? "" : "s"} read.` : "Those settlements are already in the list.", results: [] });
      setFilter("open");
      router.refresh();
    });

  async function upload(files: File[]) {
    if (files.length === 0) return;
    setError(null);
    setNotice(null);
    const results: { ok: boolean; message?: string }[] = [];
    try {
      for (const [i, file] of files.entries()) {
        setUploading(`Reading ${i + 1} of ${files.length}: ${file.name}`);
        let res: Response;
        if (props.directUploads) {
          const safe = file.name.replace(/[^\w.\- ]+/g, "_").slice(-80);
          const blob = await uploadToBlob(`${props.incomingFolder}${Date.now()}-${i}-${safe}`, file, { access: "private", handleUploadUrl: "/api/automation/settlements/uploads" });
          res = await fetch("/api/automation/settlements", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uploads: [{ pathname: blob.pathname, name: file.name }] }) });
        } else {
          const body = new FormData();
          body.append("file", file);
          res = await fetch("/api/automation/settlements", { method: "POST", body });
        }
        const json = (await res.json()) as { results?: { name: string; settlements?: { settlementId: string; existing: boolean }[]; error?: string }[]; error?: string };
        if (json.error) results.push({ ok: false, message: `${file.name}: ${json.error}` });
        for (const r of json.results ?? []) {
          if (r.error) results.push({ ok: false, message: r.error });
          else
            for (const s of r.settlements ?? []) results.push({ ok: !s.existing, message: s.existing ? `Settlement ${s.settlementId} is already in the list.` : `Settlement ${s.settlementId} read from ${r.name}.` });
        }
      }
    } catch {
      results.push({ ok: false, message: "Upload failed. Check your connection and try again." });
    } finally {
      setUploading(null);
      if (fileRef.current) fileRef.current.value = "";
    }
    setFilter("open");
    setNotice({ title: `${results.filter((r) => r.ok).length} new settlement${results.filter((r) => r.ok).length === 1 ? "" : "s"}.`, results });
    router.refresh();
  }

  const toPush = props.rows.filter((r) => pushing?.includes(r.id));

  return (
    <div className="mt-6 space-y-6">
      <AccountsPanel settings={props.settings} buckets={props.buckets} erp={props.erp} canEdit={props.canEdit} target={props.target} targets={props.targets} />

      {props.canEdit &&
        (props.demo ? (
          <section className="rounded-xl border border-dashed border-border p-5">
            <p className="font-medium">Try a sample settlement report</p>
            <p className="mt-1 text-sm text-muted">The live demo takes no uploads. These are invented reports, read just as an upload would be.</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {props.samples.map((s) => (
                <button key={s.id} type="button" onClick={() => sample(s.id)} disabled={busy} className="rounded-lg border border-border bg-surface p-3 text-left text-sm transition-colors hover:bg-surface-muted disabled:opacity-50">
                  <span className="font-medium">{s.title}</span>
                  <span className="mt-0.5 block text-xs text-muted">{s.shows}</span>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void upload([...e.dataTransfer.files]);
            }}
            className="flex cursor-pointer flex-col items-center rounded-xl border border-dashed border-border p-8 text-center hover:bg-surface-muted/50"
          >
            <input ref={fileRef} type="file" accept={ACCEPT} multiple className="sr-only" disabled={Boolean(uploading)} onChange={(e) => void upload([...(e.target.files ?? [])])} />
            <span className="font-medium">Drop settlement reports here, or click to choose</span>
            <span className="mt-1 text-sm text-muted">As the marketplace exports them: Amazon flat files (.txt), CSV, Excel or PDF. A file with several settlements gives one journal each.</span>
          </label>
        ))}
      {uploading && (
        <p className="text-sm text-muted" role="status">
          {uploading}
        </p>
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

      <section>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5" role="tablist" aria-label="Filter settlements">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)} className={`rounded-md px-3 py-1 text-sm ${filter === f.id ? "bg-brand-soft font-medium text-foreground" : "text-muted hover:text-foreground"}`}>
                {f.label} <span className="text-xs text-muted">{counts[f.id]}</span>
              </button>
            ))}
          </div>
          {counts.approved > 0 && (
            <a href="/api/automation/settlements/export?approved=1" className={`${buttonClass("secondary")} ml-auto`}>
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
            <a href={`/api/automation/settlements/export?ids=${picked.map((r) => r.id).join(",")}`} className={buttonClass("secondary")}>
              Download CSV
            </a>
            {props.target && (
              <button type="button" className={buttonClass("secondary")} disabled={busy || pushable.length === 0} onClick={() => setPushing(pushable.map((r) => r.id))}>
                Push {pushable.length || ""} approved to Business Central
              </button>
            )}
            {picked.length > approvable.length + pushable.length && <span className="text-xs text-muted">{picked.length - approvable.length - pushable.length} can&apos;t be approved yet.</span>}
            <button type="button" className="ml-auto text-muted hover:text-foreground" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        )}

        {shown.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">{props.rows.length === 0 ? "No settlements yet." : "Nothing here."}</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[52rem] text-sm">
              <thead className="bg-surface-muted text-left text-xs text-muted">
                <tr>
                  <th className="w-10 px-3 py-2">{props.canEdit && <input type="checkbox" aria-label="Select all shown" checked={allPicked} onChange={() => setSelected(allPicked ? new Set() : new Set(shown.map((r) => r.id)))} />}</th>
                  <th className="px-3 py-2 font-medium">Settlement</th>
                  <th className="px-3 py-2 font-medium">Period · posting</th>
                  <th className="px-3 py-2 font-medium">Amount types</th>
                  <th className="px-3 py-2 text-right font-medium">Payout</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="px-3 py-3">{props.canEdit && <input type="checkbox" aria-label={`Select ${r.settlementId}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />}</td>
                    <td className="px-3 py-3">
                      <p className="font-medium">{r.marketplace}</p>
                      <p className="text-xs text-muted">{r.settlementId}</p>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <p>{r.periodStart && r.periodEnd && r.periodStart !== r.periodEnd ? `${r.periodStart} → ${r.periodEnd}` : r.periodEnd || "—"}</p>
                      <p className="text-xs text-muted">posts {r.postingDate || "—"}</p>
                    </td>
                    <td className="px-3 py-3">
                      <p>
                        {r.categories} → {r.lines} journal lines
                      </p>
                      {r.unclassified > 0 && <p className="text-xs text-warn">{r.unclassified} to classify</p>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <p className="font-medium">{money(r.payout, r.currency)}</p>
                      <p className={`text-xs ${r.checksOk ? "text-success" : "text-danger"}`}>{r.checksOk ? "✓ balances" : "✕ doesn't add up"}</p>
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill status={r.status} />
                      {r.erp && <p className="mt-1 text-xs text-muted">{r.erp}</p>}
                      {r.status !== "pushed" && r.blockers.length > 0 && (
                        <p className="mt-1 max-w-56 text-xs text-warn" title={r.blockers.join("\n")}>
                          {r.blockers[0]}
                          {r.blockers.length > 1 ? ` (+${r.blockers.length - 1})` : ""}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <Link href={`/automation/settlements/${r.id}`} className="text-sm font-medium text-brand hover:underline">
                        {r.status === "pushed" ? "View" : "Review"}
                      </Link>
                      {props.canEdit && r.status === "ready" && (
                        <button type="button" className="ml-3 text-sm text-muted hover:text-foreground" disabled={busy} onClick={() => approve([r.id])}>
                          Approve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmPushDialog
        open={pushing !== null}
        title={`Add ${toPush.length} settlement journal${toPush.length === 1 ? "" : "s"} to Business Central?`}
        body={
          <>
            Each journal&apos;s lines go into the batch <strong className="font-medium text-foreground">unposted</strong>, in {props.target?.label ?? "Business Central"}. You post them there.
            Sawwi first checks the settlement isn&apos;t already in the batch or posted.
          </>
        }
        headers={["Marketplace", "Settlement", "Payout"]}
        rows={toPush.map((r) => ({ id: r.id, cells: [r.marketplace, `${r.settlementId} · ${r.postingDate}`, money(r.payout, r.currency)] }))}
        confirmLabel={`Add ${toPush.length} journal${toPush.length === 1 ? "" : "s"}`}
        busy={busy}
        onCancel={() => setPushing(null)}
        onConfirm={push}
      />
    </div>
  );
}
