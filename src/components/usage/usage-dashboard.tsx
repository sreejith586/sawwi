"use client";

import Link from "next/link";
import { useState } from "react";
import { QueryTable, type QueryColumn } from "@/components/query-table";
import { niceTicks, RANGES, type RangeId, type RunStats, type UsageRow, type UsageTotals, type UsageView } from "@/lib/usage/aggregate";
import { USAGE_SEARCH } from "@/lib/usage/columns";

// The usage/cost dashboard, shared by Settings → Usage (one workspace) and the admin
// console (every workspace). All numbers are computed on the server; this only shows them.

const int = (n: number) => n.toLocaleString("en-US");
const compact = (n: number) => (n >= 10_000 ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n) : int(n));
const pct = (n: number | null | "") => (n === null || n === "" ? "–" : `${(n * 100).toFixed(n >= 0.995 || n === 0 ? 0 : 1)}%`);
/** Sub-dollar amounts keep four decimals, so a column of small costs lines up and never rounds to $0.01. */
const usd = (n: number) => (n === 0 ? "$0.00" : n < 1 ?`$${n.toFixed(4)}` : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dayLabel = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
const dateTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

const VIEW_LABELS: Record<UsageView, string> = { day: "By day", purpose: "By purpose", model: "By model", run: "By run", workspace: "By workspace" };

export type UsageDashboardProps = {
  admin: boolean;
  range: RangeId;
  /** Page path the range links point at, e.g. /settings/usage. */
  basePath: string;
  /** Excel export route, e.g. /api/usage. */
  exportPath: string;
  totals: UsageTotals;
  runs: RunStats;
  daily: { day: string; cost: number; calls: number }[];
  rows: Record<UsageView, UsageRow[]>;
  prices: { asOf: string; source: string; models: { id: string; label: string; input: number; cacheRead: number; cacheWrite: number; output: number }[] };
};

export function UsageDashboard(props: UsageDashboardProps) {
  const { admin, range, basePath, totals, runs } = props;
  const views: UsageView[] = admin ? ["day", "workspace", "purpose", "model", "run"] : ["day", "purpose", "model", "run"];
  const [view, setView] = useState<UsageView>("day");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Period" className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm">
          {RANGES.map((r) => (
            <Link
              key={r.id}
              href={`${basePath}?range=${r.id}`}
              aria-current={r.id === range ? "page" : undefined}
              className={`rounded-md px-2.5 py-1 ${r.id === range ? "bg-surface-muted font-medium text-foreground" : "text-muted hover:text-foreground"}`}
            >
              {r.label}
            </Link>
          ))}
        </nav>
        <p className="text-xs text-muted">Estimated at list prices as of {dayLabel(props.prices.asOf)}. Days are in UTC.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Estimated cost" value={usd(totals.cost)} note={totals.unpricedCalls ? `${int(totals.unpricedCalls)} calls on an unpriced model not included` : `${int(totals.calls)} AI calls`} />
        <Stat label="Tokens" value={compact(totals.totalTokens)} note={`${compact(totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens)} in · ${compact(totals.outputTokens)} out`} />
        <Stat label="Cache hit rate" value={pct(totals.hitRate)} note="Prompt tokens read from cache" />
        <Stat
          label="Repeat runs that asked nothing"
          value={pct(runs.askedNothingRate)}
          note={runs.repeats ? `${int(runs.repeatsAskedNothing)} of ${int(runs.repeats)} repeat runs · ${int(runs.runs)} runs in all` : `${int(runs.runs)} runs, no repeats yet`}
          tone={runs.askedNothingRate === null ? undefined : runs.askedNothingRate >= 0.8 ? "text-success" : runs.askedNothingRate < 0.5 ? "text-warn" : undefined}
        />
      </div>

      <section>
        <h2 className="text-sm font-semibold">Estimated cost per day</h2>
        <div className="mt-3 rounded-xl border border-border bg-surface p-4">
          <CostChart daily={props.daily} />
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Breakdown</h2>
          <div role="tablist" aria-label="Breakdown" className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm">
            {views.map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={v === view}
                onClick={() => setView(v)}
                className={`rounded-md px-2.5 py-1 ${v === view ? "bg-surface-muted font-medium text-foreground" : "text-muted hover:text-foreground"}`}
              >
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3">
          <BreakdownTable key={view} view={view} admin={admin} rows={props.rows[view]} range={range} exportPath={props.exportPath} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">Prices used</h2>
        <p className="mt-0.5 text-sm text-muted">
          US dollars per million tokens. {props.prices.source}. Updated {dayLabel(props.prices.asOf)}.
        </p>
        <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted/50 text-xs text-muted">
              <tr>
                {["Model", "Input", "Cache read", "Cache write (1h)", "Output"].map((h, i) => (
                  <th key={h} className={`px-3 py-2.5 font-medium ${i ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {props.prices.models.map((m) => (
                <tr key={m.id}>
                  <td className="px-3 py-2">
                    {m.label} <span className="text-xs text-muted">{m.id}</span>
                  </td>
                  {[m.input, m.cacheRead, m.cacheWrite, m.output].map((v, i) => (
                    <td key={i} className="tabular px-3 py-2 text-right">
                      ${v.toFixed(2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`tabular mt-1.5 text-xl font-semibold tracking-tight ${tone ?? ""}`}>{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

function BreakdownTable({ view, admin, rows, range, exportPath }: { view: UsageView; admin: boolean; rows: UsageRow[]; range: RangeId; exportPath: string }) {
  const first: QueryColumn<UsageRow>[] =
    view === "day"
      ? [{ key: "label", header: "Day", render: (r) => <span className="whitespace-nowrap">{dayLabel(r.label)}</span> }]
      : view === "run"
        ? [
            { key: "label", header: "Run started", render: (r) => <span className="whitespace-nowrap text-muted">{r.label ? dateTime(r.label) : "–"}</span> },
            {
              key: "detail",
              header: "Reconciliation",
              render: (r) =>
                r.id !== "-" && !admin ? (
                  <Link href={`/runs/${r.id}`} className="font-medium hover:underline">
                    {r.detail || "Deleted run"}
                  </Link>
                ) : (
                  r.detail || "No run"
                ),
            },
            ...(admin ? [{ key: "workspace" as const, header: "Workspace", cellClass: () => "text-muted" }] : []),
          ]
        : view === "model"
          ? [{ key: "label", header: "Model", render: (r) => <span>{r.label} <span className="text-xs text-muted">{r.detail}</span></span> }]
          : [{ key: "label", header: view === "purpose" ? "Purpose" : "Workspace", render: (r) => <span className="font-medium">{r.label}</span> }];

  const columns: QueryColumn<UsageRow>[] = [
    ...first,
    { key: "calls", header: "Calls", align: "right", render: (r) => int(r.calls) },
    { key: "inputTokens", header: "Input", align: "right", render: (r) => int(r.inputTokens) },
    { key: "cacheReadTokens", header: "Cache read", align: "right", render: (r) => int(r.cacheReadTokens) },
    { key: "cacheWriteTokens", header: "Cache write", align: "right", render: (r) => int(r.cacheWriteTokens) },
    { key: "outputTokens", header: "Output", align: "right", render: (r) => int(r.outputTokens) },
    { key: "hitRate", header: "Hit rate", align: "right", render: (r) => pct(r.hitRate) },
    {
      key: "cost",
      header: "Est. cost",
      align: "right",
      render: (r) => (
        <span title={r.unpricedCalls ? `${r.unpricedCalls} calls on a model with no listed price are not included` : undefined}>
          {usd(r.cost)}
          {r.unpricedCalls ? " *" : ""}
        </span>
      ),
      cellClass: () => "font-medium",
    },
  ];

  return (
    <QueryTable
      rows={rows}
      columns={columns}
      searchFields={[...USAGE_SEARCH]}
      searchPlaceholder={view === "run" ? "Search reconciliations" : "Search"}
      filters={view === "run" ? [{ key: "detail", label: "Reconciliation", allLabel: "All reconciliations" }, ...(admin ? [{ key: "workspace" as const, label: "Workspace", allLabel: "All workspaces" }] : [])] : []}
      initialSort={view === "day" || view === "run" ? { sort: "label", dir: "desc" } : { sort: "cost", dir: "desc" }}
      exportHref={(params) => `${exportPath}?view=${view}&range=${range}${params ? `&${params}` : ""}`}
      emptyMessage="No AI calls in this period. Repeat runs with remembered mappings make none."
      dense
    />
  );
}

// ─── Chart: one series (cost per day), so no legend; the section title names it ────

function CostChart({ daily }: { daily: { day: string; cost: number; calls: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...daily.map((d) => d.cost));
  if (max === 0) return <p className="py-10 text-center text-sm text-muted">No cost in this period.</p>;

  const W = 720;
  const H = 180;
  const pad = { top: 12, right: 8, bottom: 24, left: 52 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const band = plotW / daily.length;
  const barW = Math.max(1, Math.min(24, band - 2));
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;
  const labelEvery = Math.ceil(daily.length / 8);
  const h = hover === null ? null : daily[hover];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Estimated cost per day" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[10px] tabular">
              {t === 0 ? "$0" : `$${Number(t.toFixed(4))}`}
            </text>
          </g>
        ))}
        {daily.map((d, i) => {
          const x = pad.left + i * band + (band - barW) / 2;
          const bh = (d.cost / top) * plotH;
          const r = Math.min(4, barW / 2, bh);
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)}>
              {/* Hit target is the whole band, taller than the bar. */}
              <rect x={pad.left + i * band} y={pad.top} width={band} height={plotH} fill="transparent" />
              {d.cost > 0 && (
                <path
                  d={`M${x},${y(0)} V${y(0) - bh + r} q0,-${r} ${r},-${r} H${x + barW - r} q${r},0 ${r},${r} V${y(0)} Z`}
                  fill="var(--chart-1)"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
              {i % labelEvery === 0 && (
                <text x={pad.left + i * band + band / 2} y={H - 6} textAnchor="middle" className="fill-muted text-[10px]">
                  {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d.day}T00:00:00Z`))}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {h && hover !== null && (
        <div
          className={`pointer-events-none absolute top-0 z-10 rounded-md ${hover < daily.length * 0.2 ? "" : hover > daily.length * 0.8 ? "-translate-x-full" : "-translate-x-1/2"} whitespace-nowrap border border-border bg-surface px-2.5 py-1.5 text-xs shadow-sm`}
          style={{ left: `${((pad.left + hover * band + band / 2) / W) * 100}%` }}
        >
          <p className="font-medium">{dayLabel(h.day)}</p>
          <p className="tabular text-muted">
            {usd(h.cost)} · {int(h.calls)} call{h.calls === 1 ? "" : "s"}
          </p>
        </div>
      )}
    </div>
  );
}
