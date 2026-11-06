"use client";

import type { Severity } from "@/lib/recon/severity";
import type { SortDir } from "@/lib/recon/table";

// Small building blocks for sortable, filterable report tables.

export function SortHeader({
  label,
  field,
  sort,
  dir,
  onSort,
  align = "left",
}: {
  label: string;
  field: string;
  sort?: string;
  dir?: SortDir;
  onSort: (field: string) => void;
  align?: "left" | "right";
}) {
  const active = sort === field;
  return (
    <th className={`whitespace-nowrap px-3 py-2.5 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 rounded hover:text-foreground ${active ? "text-foreground" : "text-muted"}`}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <span aria-hidden className="text-[10px]">
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-8 w-full min-w-0 rounded-md border border-border bg-surface px-2.5 text-sm outline-none placeholder:text-muted focus:border-foreground/40 sm:w-56"
    />
  );
}

export function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-sm text-muted">
      <span className="sr-only sm:not-sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-8 max-w-52 rounded-md border border-border bg-surface px-2 text-sm text-foreground outline-none focus:border-foreground/40"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ExcelButton({ href, label = "Excel" }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-sm font-medium hover:bg-surface-muted"
      download
    >
      <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M8 2v8m0 0 3-3m-3 3L5 7M3 12.5h10" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label}
    </a>
  );
}

const SEVERITY_STYLE: Record<Severity | "ok" | "neutral", string> = {
  high: "bg-danger-soft text-danger",
  medium: "bg-warn-soft text-warn",
  info: "bg-info-soft text-info",
  ok: "bg-success-soft text-success",
  neutral: "bg-surface-muted text-muted",
};

export const SEVERITY_LABEL: Record<Severity, string> = { high: "High", medium: "Follow up", info: "Info" };

export function Pill({ tone, children }: { tone: keyof typeof SEVERITY_STYLE; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLE[tone]}`}>{children}</span>;
}

export function SeverityDot({ tone }: { tone: Severity | "ok" | "neutral" }) {
  const color = { high: "bg-danger", medium: "bg-warn", info: "bg-info", ok: "bg-success", neutral: "bg-border" }[tone];
  return <span aria-hidden className={`inline-block size-2 shrink-0 rounded-full ${color}`} />;
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)} className="rounded-md border border-border px-2 py-1 disabled:opacity-40">
        Previous
      </button>
      <span className="tabular">
        {page + 1} / {pages}
      </span>
      <button type="button" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} className="rounded-md border border-border px-2 py-1 disabled:opacity-40">
        Next
      </button>
    </div>
  );
}

export function nextSort(current: { sort?: string; dir?: SortDir }, field: string): { sort: string; dir: SortDir } {
  if (current.sort !== field) return { sort: field, dir: "desc" };
  return { sort: field, dir: current.dir === "desc" ? "asc" : "desc" };
}
