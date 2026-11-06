"use client";

import { useMemo, useState } from "react";
import {
  ExcelButton,
  FilterSelect,
  nextSort,
  Pager,
  Pill,
  SearchInput,
  SEVERITY_LABEL,
  SeverityDot,
  SortHeader,
} from "@/components/data-table";
import { applyQuery, queryToParams, type SortDir, type TableQuery } from "@/lib/recon/table";
import type { ReportCheck, ReportView } from "@/lib/runs/view";

const PAGE_SIZE = 50;

const money = (n: number | undefined, currency?: string) =>
  n === undefined ? "" : `${currency ? `${currency} ` : ""}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n: number) => n.toLocaleString("en-US");
const pct = (n: number) => `${(Math.round(n * 1000) / 10).toFixed(1)}%`;

function rateTone(rate: number) {
  return rate >= 0.95 ? "text-success" : rate >= 0.8 ? "text-warn" : "text-danger";
}
function rateBar(rate: number) {
  return rate >= 0.95 ? "bg-success" : rate >= 0.8 ? "bg-warn" : "bg-danger";
}

export function Report({ runId, report }: { runId: string; report: ReportView }) {
  const [exceptionCheck, setExceptionCheck] = useState("all");
  const main = report.links[0];
  const rate = main && main.leftRows ? main.matchedLeft / main.leftRows : 0;
  const automated = report.checks.filter((c) => c.status === "done").length;
  const exportBase = `/api/runs/${runId}/export`;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Reconciliation report</h2>
          <p className="text-sm text-muted">
            Data as of {report.asOf} · run {new Date(report.ranAt).toLocaleString()}
          </p>
        </div>
        <ExcelButton href={`${exportBase}?table=all`} label="Download full report" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Match rate" value={pct(rate)} tone={rateTone(rate)}>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted">
            <div className={`h-full rounded-full ${rateBar(rate)}`} style={{ width: `${Math.min(100, rate * 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted tabular">
            {num(main?.matchedLeft ?? 0)} of {num(main?.leftRows ?? 0)} rows
          </p>
        </Tile>
        <Tile label="Exceptions" value={num(report.totals.exceptions)} tone={report.totals.exceptions ? "text-danger" : "text-success"}>
          <p className="mt-2 text-xs text-muted">{report.checks.filter((c) => c.count > 0).length} checks with findings</p>
        </Tile>
        <Tile label="Value at risk" value={money(report.totals.value, report.currency)} tone={report.totals.value ? "text-danger" : "text-success"}>
          <p className="mt-2 text-xs text-muted">Unmatched and mismatched amounts</p>
        </Tile>
        <Tile label="Checks run" value={`${automated} / ${report.checks.length}`} tone="text-foreground">
          <p className="mt-2 text-xs text-muted">{report.checks.length - automated} need data or aren&apos;t automated yet</p>
        </Tile>
      </div>

      <LinksTable report={report} exportHref={`${exportBase}?table=links`} />
      <ChecksTable
        report={report}
        exportBase={exportBase}
        onPick={(id) => {
          setExceptionCheck(id);
          document.getElementById("exceptions")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />
      <ExceptionsTable report={report} exportBase={exportBase} check={exceptionCheck} onCheck={setExceptionCheck} />
    </section>
  );
}

function Tile({ label, value, tone, children }: { label: string; value: string; tone: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tracking-tight tabular ${tone}`}>{value}</p>
      {children}
    </div>
  );
}

function Card({ title, actions, children, id }: { title: string; actions?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <div id={id} className="scroll-mt-6 overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <h3 className="mr-auto text-sm font-semibold">{title}</h3>
        {actions}
      </div>
      {children}
    </div>
  );
}

// ─── Matching summary ─────────────────────────────────────────────────────

function LinksTable({ report, exportHref }: { report: ReportView; exportHref: string }) {
  return (
    <Card title="How the files matched" actions={<ExcelButton href={exportHref} />}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted/60 text-left text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Files</th>
              <th className="px-3 py-2.5 text-right font-medium">Left rows</th>
              <th className="px-3 py-2.5 text-right font-medium">Right rows</th>
              <th className="px-3 py-2.5 font-medium">Matched</th>
              <th className="px-3 py-2.5 text-right font-medium">Left total</th>
              <th className="px-4 py-2.5 text-right font-medium">Right total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {report.links.map((l, i) => {
              const rate = l.leftRows ? l.matchedLeft / l.leftRows : 0;
              return (
                <tr key={i}>
                  <td className="px-4 py-3">
                    <span className="font-medium">{l.leftLabel}</span>
                    <span className="mx-1.5 text-muted">↔</span>
                    <span className="font-medium">{l.rightLabel}</span>
                  </td>
                  <td className="px-3 py-3 text-right tabular">{num(l.leftRows)}</td>
                  <td className="px-3 py-3 text-right tabular">{num(l.rightRows)}</td>
                  <td className="px-3 py-3">
                    {l.skipped ? (
                      <span className="text-muted">{l.skipped}</span>
                    ) : (
                      <div className="flex min-w-36 items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                          <div className={`h-full rounded-full ${rateBar(rate)}`} style={{ width: `${rate * 100}%` }} />
                        </div>
                        <span className={`w-12 text-right text-xs font-medium tabular ${rateTone(rate)}`}>{pct(rate)}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular">{money(l.leftTotal, report.currency)}</td>
                  <td className="px-4 py-3 text-right tabular">{money(l.rightTotal, report.currency)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ─── Checks ───────────────────────────────────────────────────────────────

type CheckFilter = "all" | "findings" | "high" | "medium" | "info" | "clean" | "not_run";

const TONE_TEXT = { high: "text-danger", medium: "text-warn", info: "text-info", ok: "text-success", neutral: "text-muted" } as const;

function checkTone(c: ReportCheck) {
  if (c.status !== "done") return "neutral" as const;
  return c.count === 0 ? ("ok" as const) : c.severity;
}

function ChecksTable({ report, exportBase, onPick }: { report: ReportView; exportBase: string; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<CheckFilter>("all");
  const [sort, setSort] = useState<{ sort?: string; dir?: SortDir }>({ sort: "value", dir: "desc" });

  const rows = useMemo(() => {
    const base = report.checks.map((c) => ({ ...c, tone: checkTone(c) }));
    const filtered = base.filter((c) => {
      if (filter === "findings") return c.count > 0;
      if (filter === "clean") return c.status === "done" && c.count === 0;
      if (filter === "not_run") return c.status !== "done";
      if (filter === "high" || filter === "medium" || filter === "info") return c.status === "done" && c.severity === filter && c.count > 0;
      return true;
    });
    return applyQuery(filtered, { q, ...sort }, ["label", "description"]);
  }, [report.checks, q, filter, sort]);

  // Server export supports severity/status filters; findings/clean are applied client-side only.
  const exportQuery: TableQuery = { q, ...sort, filters: { severity: ["high", "medium", "info"].includes(filter) ? filter : undefined } };

  return (
    <Card
      title="Checks"
      actions={
        <>
          <SearchInput value={q} onChange={setQ} placeholder="Search checks" />
          <FilterSelect
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All checks" },
              { value: "findings", label: "With findings" },
              { value: "high", label: "High severity" },
              { value: "medium", label: "Follow up" },
              { value: "info", label: "Info" },
              { value: "clean", label: "No issues" },
              { value: "not_run", label: "Not run" },
            ]}
          />
          <ExcelButton href={`${exportBase}?table=checks&${queryToParams(exportQuery)}`} />
        </>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted/60">
            <tr>
              <SortHeader label="Check" field="label" {...sort} onSort={(f) => setSort(nextSort(sort, f))} />
              <SortHeader label="Severity" field="severity" {...sort} onSort={(f) => setSort(nextSort(sort, f))} />
              <SortHeader label="Exceptions" field="count" align="right" {...sort} onSort={(f) => setSort(nextSort(sort, f))} />
              <SortHeader label="Value" field="value" align="right" {...sort} onSort={(f) => setSort(nextSort(sort, f))} />
              <th className="w-24 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-surface-muted/40">
                <td className="px-3 py-3">
                  <div className="flex items-start gap-2.5">
                    <span className="mt-1.5">
                      <SeverityDot tone={c.tone} />
                    </span>
                    <div>
                      <p className="font-medium">{c.label}</p>
                      <p className="mt-0.5 text-xs text-muted">{c.status === "done" ? c.description : c.reason}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3">
                  {c.status !== "done" ? (
                    <Pill tone="neutral">Not run</Pill>
                  ) : c.count === 0 ? (
                    <Pill tone="ok">Clear</Pill>
                  ) : (
                    <Pill tone={c.severity}>{SEVERITY_LABEL[c.severity]}</Pill>
                  )}
                </td>
                <td className={`px-3 py-3 text-right font-medium tabular ${TONE_TEXT[c.tone]}`}>
                  {c.status === "done" ? num(c.count) : "–"}
                </td>
                <td className={`px-3 py-3 text-right tabular ${c.value ? TONE_TEXT[c.tone] : "text-muted"}`}>{c.value ? money(c.value, report.currency) : "–"}</td>
                <td className="px-3 py-3 text-right">
                  {c.count > 0 && (
                    <button type="button" onClick={() => onPick(c.id)} className="text-xs font-medium underline decoration-border underline-offset-4 hover:decoration-foreground">
                      View
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted">
                  No checks match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ─── Exceptions ───────────────────────────────────────────────────────────

function ExceptionsTable({
  report,
  exportBase,
  check,
  onCheck,
}: {
  report: ReportView;
  exportBase: string;
  check: string;
  onCheck: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [severity, setSeverity] = useState("all");
  const [sort, setSort] = useState<{ sort?: string; dir?: SortDir }>({ sort: "value", dir: "desc" });
  const [page, setPage] = useState(0);

  const query: TableQuery = { q, ...sort, filters: { check, severity } };
  const rows = useMemo(
    () => applyQuery(report.exceptions, query, ["key", "checkLabel", "note", "leftRows", "rightRows"]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [report.exceptions, q, sort, check, severity],
  );
  const pages = Math.ceil(rows.length / PAGE_SIZE);
  const current = Math.min(page, Math.max(0, pages - 1));
  const visible = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const withFindings = report.checks.filter((c) => c.count > 0);
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(0);
  };

  return (
    <Card
      id="exceptions"
      title={`Exceptions (${num(rows.length)})`}
      actions={
        <>
          <SearchInput value={q} onChange={resetPage(setQ)} placeholder="Search key, note or row" />
          <FilterSelect
            label="Check"
            value={check}
            onChange={resetPage(onCheck)}
            options={[{ value: "all", label: "All checks" }, ...withFindings.map((c) => ({ value: c.id, label: `${c.label} (${c.count})` }))]}
          />
          <FilterSelect
            label="Severity"
            value={severity}
            onChange={resetPage(setSeverity)}
            options={[
              { value: "all", label: "Any" },
              { value: "high", label: "High" },
              { value: "medium", label: "Follow up" },
              { value: "info", label: "Info" },
            ]}
          />
          <ExcelButton href={`${exportBase}?table=exceptions&${queryToParams(query)}`} />
        </>
      }
    >
      {report.exceptions.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-success">No exceptions. Everything reconciles.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted/60">
                <tr>
                  <SortHeader label="Check" field="checkLabel" {...sort} onSort={(f) => setSort(nextSort(sort, f))} />
                  <SortHeader label="Key" field="key" {...sort} onSort={(f) => setSort(nextSort(sort, f))} />
                  <SortHeader label="Left" field="leftValue" align="right" {...sort} onSort={(f) => setSort(nextSort(sort, f))} />
                  <SortHeader label="Right" field="rightValue" align="right" {...sort} onSort={(f) => setSort(nextSort(sort, f))} />
                  <SortHeader label="Difference" field="diff" align="right" {...sort} onSort={(f) => setSort(nextSort(sort, f))} />
                  <SortHeader label="At risk" field="value" align="right" {...sort} onSort={(f) => setSort(nextSort(sort, f))} />
                  <th className="px-3 py-2.5 text-left font-medium text-muted">Where</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((e) => (
                  <tr key={e.id} className="hover:bg-surface-muted/40">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <SeverityDot tone={e.severity} />
                        <span className="whitespace-nowrap">{e.checkLabel}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-xs">{e.key}</span>
                      {e.note && <p className="mt-0.5 text-xs text-muted">{e.note}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular">{money(e.leftValue)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{money(e.rightValue)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Difference diff={e.diff} />
                    </td>
                    <td className={`px-3 py-2.5 text-right font-medium tabular ${e.value ? TONE_TEXT[e.severity] : "text-muted"}`}>
                      {e.value ? money(e.value) : "–"}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted">
                      {e.leftRows && <div className="whitespace-nowrap">{e.leftFile}: row {e.leftRows}</div>}
                      {e.rightRows && <div className="whitespace-nowrap">{e.rightFile}: row {e.rightRows}</div>}
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted">
                      No exceptions match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
            <p className="text-xs text-muted">
              {report.truncated ? "Showing the first exceptions found. The Excel download includes all of them." : `Amounts in ${report.currency ?? "file currency"}.`}
            </p>
            <Pager page={current} pages={pages} onPage={setPage} />
          </div>
        </>
      )}
    </Card>
  );
}

/** Positive = left side higher (e.g. short paid); negative = right side higher (e.g. overpaid). */
function Difference({ diff }: { diff?: number }) {
  if (diff === undefined || diff === 0) return <span className="text-muted">–</span>;
  const leftHigher = diff > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium tabular ${leftHigher ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn"}`}
      title={leftHigher ? "Left side is higher" : "Right side is higher"}
    >
      {leftHigher ? "▼" : "▲"} {Math.abs(diff).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}
