"use client";

import { uploadPresigned as uploadToBlob } from "@vercel/blob/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { ConfirmPushDialog, money, ResultList, StatusPill, type Status } from "@/components/automation/shared";
import { buttonClass } from "@/components/ui";
import { approveRemittancesAction, captureCodSampleAction, pushRemittancesAction, rematchCodAction, updateCodSettingsAction } from "@/app/actions/cod";

// The COD remittance queue (D-74): every batch's parcels, what's applied and what needs a decision;
// single and bulk approve, CSV, push; and the accounts and batches the entries use.

export type CodRow = {
  id: string;
  courier: string;
  batchId: string;
  status: Status;
  postingDate: string;
  currency: string;
  parcels: number;
  undecided: number;
  flagged: number;
  totals: { collected: number; fees: number; vat: number; net: number; applied: number; onAccount: number; leftOut: number };
  checksOk: boolean;
  blockers: string[];
  hash: string;
  erp: string | null;
};

type Batch = { id: string; code: string; name: string };
type Erp = { company: string; lcy: string; accounts: { number: string; name: string }[]; customers: { number: string; name: string }[]; paymentJournals: Batch[]; generalJournals: Batch[]; fetchedAt: string };
type Settings = { accounts: Record<string, string | undefined>; defaultCustomer: string; paymentJournalId: string | null; generalJournalId: string | null };

type Props = {
  rows: CodRow[];
  canEdit: boolean;
  demo: boolean;
  samples: { id: string; title: string; shows: string }[];
  directUploads: boolean;
  incomingFolder: string;
  targets: { connectionId: string; label: string }[];
  target: { connectionId: string; label: string } | null;
  settings: Settings;
  erp: Erp | null;
};

const ACCOUNTS: { key: "bank" | "clearing" | "fees" | "feeVat"; label: string; hint: string }[] = [
  { key: "bank", label: "Bank", hint: "Where the courier pays the net remittance." },
  { key: "clearing", label: "Courier clearing", hint: "Collected cash in transit. Set it as the balancing account of the customer payment batch in Business Central too, so it nets to zero." },
  { key: "fees", label: "COD fees", hint: "The courier's collection charges." },
  { key: "feeVat", label: "VAT on fees (input VAT)", hint: "VAT the courier charged on its fees." },
];
const FILTERS = [
  { id: "open", label: "To review" },
  { id: "approved", label: "Approved" },
  { id: "pushed", label: "In ERP" },
  { id: "all", label: "All" },
] as const;
const input = "h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm";

function Setup(props: Pick<Props, "settings" | "erp" | "canEdit" | "target" | "targets">) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Record<string, string>>(() => Object.fromEntries(ACCOUNTS.map((a) => [a.key, props.settings.accounts[a.key] ?? ""])));
  const [customer, setCustomer] = useState(props.settings.defaultCustomer);
  const [pj, setPj] = useState(props.settings.paymentJournalId ?? "");
  const [gj, setGj] = useState(props.settings.generalJournalId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const missing = ACCOUNTS.filter((a) => !props.settings.accounts[a.key]).length;
  const [open, setOpen] = useState(missing > 0);

  const save = () =>
    start(async () => {
      setError(null);
      const res = await updateCodSettingsAction({ accounts, defaultCustomer: customer, paymentJournalId: pj || null, generalJournalId: gj || null });
      if (res.error) return setError(res.error);
      setSaved("Saved. Batches updated.");
      router.refresh();
    });
  const setTarget = (value: string) =>
    start(async () => {
      const res = await updateCodSettingsAction({ target: value || "" });
      if (res.error) setError(res.error);
      router.refresh();
    });
  const rematch = () =>
    start(async () => {
      const res = await rematchCodAction();
      if (res.error) return setError(res.error);
      setSaved(`Read invoices again. ${res.changed} batch${res.changed === 1 ? "" : "es"} updated.`);
      router.refresh();
    });
  const select = (value: string, onChange: (v: string) => void, items: { value: string; label: string }[], label: string) => (
    <select aria-label={label} className={`${input} ${value ? "" : "border-warn"}`} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {items.map((i) => (
        <option key={i.value} value={i.value}>
          {i.label}
        </option>
      ))}
    </select>
  );

  return (
    <section className="rounded-xl border border-border bg-surface">
      <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="font-medium">Accounts and batches</span>
        <span className={`text-xs ${missing ? "text-warn" : "text-muted"}`}>{missing ? `${missing} account${missing === 1 ? "" : "s"} to choose` : props.target ? props.target.label : "CSV only"}</span>
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
              <div className="flex items-end">
                <button type="button" className={buttonClass("secondary")} onClick={rematch} title="Read open invoices, customers, accounts and batches again, and match every batch not yet sent">
                  Match invoices again
                </button>
              </div>
            )}
            {props.target && props.erp && (
              <>
                <label className="text-xs text-muted">
                  Customer payment batch
                  {select(pj, setPj, props.erp.paymentJournals.map((j) => ({ value: j.id, label: `${j.code} · ${j.name}` })), "Customer payment batch")}
                </label>
                <label className="text-xs text-muted">
                  General journal batch (fees and bank)
                  {select(gj, setGj, props.erp.generalJournals.map((j) => ({ value: j.id, label: `${j.code} · ${j.name}` })), "General journal batch")}
                </label>
              </>
            )}
          </div>
          {props.targets.length === 0 && (
            <p className="text-xs text-muted">
              To match invoices and push, <Link href="/settings/connections" className="underline">connect Business Central</Link>. Without it, type your account numbers and download CSV.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {ACCOUNTS.map((a) => (
              <label key={a.key} className="text-xs text-muted">
                {a.label}
                {props.erp ? (
                  select(accounts[a.key], (v) => setAccounts({ ...accounts, [a.key]: v }), props.erp.accounts.map((x) => ({ value: x.number, label: `${x.number} · ${x.name}` })), `Account for ${a.label}`)
                ) : (
                  <input aria-label={`Account for ${a.label}`} className={input} placeholder="Account no." value={accounts[a.key]} onChange={(e) => setAccounts({ ...accounts, [a.key]: e.target.value })} />
                )}
                <span className="mt-0.5 block">{a.hint}</span>
              </label>
            ))}
            <label className="text-xs text-muted">
              Customer for cash with no invoice
              {props.erp ? (
                <select aria-label="Default COD customer" className={input} value={customer} onChange={(e) => setCustomer(e.target.value)}>
                  <option value="">— None —</option>
                  {props.erp.customers.map((c) => (
                    <option key={c.number} value={c.number}>
                      {c.number} · {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input aria-label="Default COD customer" className={input} placeholder="Customer no." value={customer} onChange={(e) => setCustomer(e.target.value)} />
              )}
              <span className="mt-0.5 block">Used when you put a parcel on account and there&apos;s no invoice to say whose it is.</span>
            </label>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          {props.canEdit && (
            <div className="flex items-center gap-3">
              <button type="button" className={buttonClass("primary")} onClick={save}>
                Save
              </button>
              {saved && !busy && <span className="text-xs text-success">{saved}</span>}
            </div>
          )}
        </fieldset>
      )}
    </section>
  );
}

export function CodQueue(props: Props) {
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
      if (["needs_review", "ready", "pushing"].includes(r.status)) c.open++;
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
  const toPush = props.rows.filter((r) => pushing?.includes(r.id));

  const approve = (ids: string[]) =>
    start(async () => {
      setError(null);
      const res = await approveRemittancesAction(ids);
      if (res.error) return setError(res.error);
      setNotice({ title: `${res.results!.filter((r) => r.ok).length} of ${ids.length} approved.`, results: res.results! });
      setSelected(new Set());
      router.refresh();
    });
  const push = () =>
    start(async () => {
      const items = toPush.map((r) => ({ id: r.id, hash: r.hash }));
      const res = await pushRemittancesAction(items);
      setPushing(null);
      if (res.error) return setError(res.error);
      setNotice({ title: `${res.results!.filter((r) => r.ok).length} of ${items.length} added to Business Central, unposted.`, results: res.results! });
      setSelected(new Set());
      router.refresh();
    });
  const sample = (id: string) =>
    start(async () => {
      setError(null);
      const res = await captureCodSampleAction(id);
      if (res.error) return setError(res.error);
      const fresh = res.results!.filter((r) => !r.existing).length;
      setNotice({ title: fresh ? `${fresh} batch${fresh === 1 ? "" : "es"} read and matched.` : "That batch is already in the list.", results: [] });
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
          const blob = await uploadToBlob(`${props.incomingFolder}${Date.now()}-${i}-${safe}`, file, { access: "private", handleUploadUrl: "/api/automation/cod/uploads" });
          res = await fetch("/api/automation/cod", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uploads: [{ pathname: blob.pathname, name: file.name }] }) });
        } else {
          const body = new FormData();
          body.append("file", file);
          res = await fetch("/api/automation/cod", { method: "POST", body });
        }
        const json = (await res.json()) as { results?: { name: string; batches?: { batchId: string; courier: string; existing: boolean }[]; error?: string }[]; error?: string };
        if (json.error) results.push({ ok: false, message: `${file.name}: ${json.error}` });
        for (const r of json.results ?? []) {
          if (r.error) results.push({ ok: false, message: r.error });
          else for (const b of r.batches ?? []) results.push({ ok: !b.existing, message: b.existing ? `${b.courier} ${b.batchId} is already in the list.` : `${b.courier} ${b.batchId} read from ${r.name}.` });
        }
      }
    } catch {
      results.push({ ok: false, message: "Upload failed. Check your connection and try again." });
    } finally {
      setUploading(null);
      if (fileRef.current) fileRef.current.value = "";
    }
    setFilter("open");
    setNotice({ title: `${results.filter((r) => r.ok).length} new batch${results.filter((r) => r.ok).length === 1 ? "" : "es"}.`, results });
    router.refresh();
  }

  return (
    <div className="mt-6 space-y-6">
      <Setup settings={props.settings} erp={props.erp} canEdit={props.canEdit} target={props.target} targets={props.targets} />

      {props.canEdit &&
        (props.demo ? (
          <section className="rounded-xl border border-dashed border-border p-5">
            <p className="font-medium">Try a sample remittance report</p>
            <p className="mt-1 text-sm text-muted">The live demo takes no uploads. These are invented reports for the demo store&apos;s November COD orders.</p>
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
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.pdf" multiple className="sr-only" disabled={Boolean(uploading)} onChange={(e) => void upload([...(e.target.files ?? [])])} />
            <span className="font-medium">Drop COD remittance reports here, or click to choose</span>
            <span className="mt-1 text-sm text-muted">As the courier sends them: CSV, Excel or PDF, with AWB, order reference, collected, fee and net.</span>
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
          <div className="flex rounded-lg border border-border p-0.5" role="tablist" aria-label="Filter remittances">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)} className={`rounded-md px-3 py-1 text-sm ${filter === f.id ? "bg-brand-soft font-medium text-foreground" : "text-muted hover:text-foreground"}`}>
                {f.label} <span className="text-xs text-muted">{counts[f.id]}</span>
              </button>
            ))}
          </div>
          {counts.approved > 0 && (
            <a href="/api/automation/cod/export?approved=1" className={`${buttonClass("secondary")} ml-auto`}>
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
            <a href={`/api/automation/cod/export?ids=${picked.map((r) => r.id).join(",")}`} className={buttonClass("secondary")}>
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
          <p className="mt-6 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">{props.rows.length === 0 ? "No remittances yet." : "Nothing here."}</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="bg-surface-muted text-left text-xs text-muted">
                <tr>
                  <th className="w-10 px-3 py-2">{props.canEdit && <input type="checkbox" aria-label="Select all shown" checked={allPicked} onChange={() => setSelected(allPicked ? new Set() : new Set(shown.map((r) => r.id)))} />}</th>
                  <th className="px-3 py-2 font-medium">Courier · batch</th>
                  <th className="px-3 py-2 font-medium">Parcels</th>
                  <th className="px-3 py-2 text-right font-medium">Collected</th>
                  <th className="px-3 py-2 text-right font-medium">Fees + VAT</th>
                  <th className="px-3 py-2 text-right font-medium">Remitted</th>
                  <th className="px-3 py-2 font-medium">Applied · on account · left out</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="px-3 py-3">{props.canEdit && <input type="checkbox" aria-label={`Select ${r.batchId}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />}</td>
                    <td className="px-3 py-3">
                      <p className="font-medium">{r.courier}</p>
                      <p className="text-xs text-muted">
                        {r.batchId} · {r.postingDate || "no date"}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <p>{r.parcels}</p>
                      {r.undecided > 0 && <p className="text-xs text-warn">{r.undecided} to decide</p>}
                      {r.flagged > 0 && <p className="text-xs text-muted">{r.flagged} flagged</p>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{money(r.totals.collected)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{money(r.totals.fees + r.totals.vat)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <p className="font-medium">{money(r.totals.net, r.currency)}</p>
                      <p className={`text-xs ${r.checksOk ? "text-success" : "text-danger"}`}>{r.checksOk ? "✓ adds up" : "✕ doesn't add up"}</p>
                    </td>
                    <td className="px-3 py-3 text-xs tabular-nums">
                      {money(r.totals.applied)} · {money(r.totals.onAccount)} · {money(r.totals.leftOut)}
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
                      <Link href={`/automation/cod/${r.id}`} className="text-sm font-medium text-brand hover:underline">
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
        title={`Add ${toPush.length} COD remittance${toPush.length === 1 ? "" : "s"} to Business Central?`}
        body={
          <>
            Each parcel becomes a customer payment applied to its invoice, and the fees and bank go into the general journal, all{" "}
            <strong className="font-medium text-foreground">unposted</strong>, in {props.target?.label ?? "Business Central"}. Sawwi first checks the batch isn&apos;t already there.
          </>
        }
        headers={["Courier", "Batch", "Collected"]}
        rows={toPush.map((r) => ({ id: r.id, cells: [r.courier, `${r.batchId} · ${r.parcels} parcels`, money(r.totals.collected, r.currency)] }))}
        confirmLabel={`Add ${toPush.length} remittance${toPush.length === 1 ? "" : "s"}`}
        busy={busy}
        onCancel={() => setPushing(null)}
        onConfirm={push}
      />
    </div>
  );
}
