"use client";

import { useMemo, useState, type ReactNode } from "react";
import { applyQuery, queryToParams, type SortDir, type TableQuery } from "@/lib/recon/table";
import { ExcelButton, FilterSelect, nextSort, Pager, SearchInput, SortHeader } from "./data-table";

// Column-definition table on top of the report's building blocks. Filtering, search and
// sorting go through applyQuery, and the Excel link sends the same query to the server,
// so a download is exactly what the table shows (but with every row, not just this page).

export type QueryColumn<T> = {
  key: keyof T & string;
  header: string;
  align?: "left" | "right";
  render?: (row: T) => ReactNode;
  /** Extra classes per cell, e.g. a value color. */
  cellClass?: (row: T) => string | undefined;
  sortable?: boolean;
};

export type QueryFilter<T> = { key: keyof T & string; label: string; allLabel: string };

export function QueryTable<T extends Record<string, unknown> & { id: string }>({
  rows,
  columns,
  searchFields,
  filters = [],
  exportHref,
  searchPlaceholder = "Search",
  initialSort,
  pageSize = 25,
  emptyMessage = "Nothing to show.",
  dense = false,
}: {
  rows: T[];
  columns: QueryColumn<T>[];
  searchFields: (keyof T)[];
  filters?: QueryFilter<T>[];
  /** Builds the Excel link from the current query string; omit to hide the button. */
  exportHref?: (params: string) => string;
  searchPlaceholder?: string;
  initialSort?: { sort: string; dir: SortDir };
  pageSize?: number;
  emptyMessage?: string;
  dense?: boolean;
}) {
  const [query, setQuery] = useState<TableQuery>({ ...initialSort, filters: {} });
  const [page, setPage] = useState(0);

  const options = useMemo(
    () =>
      Object.fromEntries(
        filters.map((f) => [f.key, [...new Set(rows.map((r) => String(r[f.key] ?? "")).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))]),
      ),
    [filters, rows],
  );
  const visible = useMemo(() => applyQuery(rows, query, searchFields), [rows, query, searchFields]);
  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const current = Math.min(page, pages - 1);
  const shown = visible.slice(current * pageSize, current * pageSize + pageSize);

  const update = (next: Partial<TableQuery>) => {
    setQuery((q) => ({ ...q, ...next, filters: { ...q.filters, ...next.filters } }));
    setPage(0);
  };
  const filtered = Boolean(query.q) || Object.values(query.filters ?? {}).some((v) => v && v !== "all");
  const cell = dense ? "px-3 py-2" : "px-3 py-2.5";

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-2.5">
        <SearchInput value={query.q ?? ""} onChange={(q) => update({ q })} placeholder={searchPlaceholder} />
        {filters
          .filter((f) => options[f.key].length > 1)
          .map((f) => (
            <FilterSelect
              key={f.key}
              label={f.label}
              value={query.filters?.[f.key] ?? "all"}
              options={[{ value: "all", label: f.allLabel }, ...options[f.key].map((o) => ({ value: o, label: o }))]}
              onChange={(v) => update({ filters: { [f.key]: v } })}
            />
          ))}
        {filtered && (
          <button type="button" onClick={() => update({ q: "", filters: Object.fromEntries(filters.map((f) => [f.key, "all"])) })} className="h-8 rounded-md px-2 text-sm text-muted hover:text-foreground">
            Clear
          </button>
        )}
        {exportHref && (
          <div className="ml-auto">
            <ExcelButton href={exportHref(queryToParams(query))} />
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-muted/50 text-xs">
            <tr>
              {columns.map((c) =>
                c.sortable === false ? (
                  <th key={c.key} className={`whitespace-nowrap px-3 py-2.5 font-medium text-muted ${c.align === "right" ? "text-right" : "text-left"}`}>
                    {c.header}
                  </th>
                ) : (
                  <SortHeader
                    key={c.key}
                    label={c.header}
                    field={c.key}
                    sort={query.sort}
                    dir={query.dir}
                    align={c.align}
                    onSort={(field) => update(nextSort(query, field))}
                  />
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((r) => (
              <tr key={r.id} className="hover:bg-surface-muted/40">
                {columns.map((c) => (
                  <td key={c.key} className={`${cell} align-middle ${c.align === "right" ? "tabular whitespace-nowrap text-right" : ""} ${c.cellClass?.(r) ?? ""}`}>
                    {c.render ? c.render(r) : String(r[c.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-sm text-muted">
                  {rows.length === 0 ? emptyMessage : "No rows match your filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2 text-xs text-muted">
        <span className="tabular">{visible.length === rows.length ? `${rows.length.toLocaleString()} rows` : `${visible.length.toLocaleString()} of ${rows.length.toLocaleString()} rows`}</span>
        <Pager page={current} pages={pages} onPage={setPage} />
      </div>
    </div>
  );
}
