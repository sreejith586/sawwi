import { costOf, modelLabel, type TokenCounts } from "./pricing";

// Pure usage maths: no DB, no React, so tests cover every number the dashboard shows.

export type UsageEvent = TokenCounts & {
  runId: string | null;
  orgKey: string | null;
  /** Workspace name, filled in for the admin view. */
  workspace?: string;
  /** Template title of the run the call belonged to. */
  template?: string;
  runStartedAt?: string;
  purpose: string;
  model: string;
  createdAt: string;
};

export const PURPOSE_LABELS: Record<string, string> = {
  column_mapping: "Column mapping",
  narrative: "Report analysis",
  email_draft: "Email draft",
  explain: "Explain exception",
  chat: "Chat answer",
  invoice_extraction: "Invoice reading (AI)",
};

export const purposeLabel = (p: string) => PURPOSE_LABELS[p] ?? p;

export type UsageTotals = TokenCounts & {
  calls: number;
  totalTokens: number;
  /** Share of prompt tokens read from the cache: cache read ÷ (input + cache read + cache write). */
  hitRate: number | null;
  cost: number;
  /** Calls on a model with no listed price; their cost is left out of `cost`. */
  unpricedCalls: number;
};

export function totalsOf(events: UsageEvent[]): UsageTotals {
  const t: UsageTotals = { calls: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, totalTokens: 0, hitRate: null, cost: 0, unpricedCalls: 0 };
  for (const e of events) {
    t.calls += 1;
    t.inputTokens += e.inputTokens;
    t.cacheReadTokens += e.cacheReadTokens;
    t.cacheWriteTokens += e.cacheWriteTokens;
    t.outputTokens += e.outputTokens;
    const c = costOf(e.model, e);
    if (c === null) t.unpricedCalls += 1;
    else t.cost += c;
  }
  t.totalTokens = t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens + t.outputTokens;
  t.hitRate = hitRate(t);
  return t;
}

export function hitRate(t: TokenCounts): number | null {
  const prompt = t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens;
  return prompt === 0 ? null : t.cacheReadTokens / prompt;
}

export type UsageView = "day" | "purpose" | "model" | "run" | "workspace";

/** One table row: a group of calls with its totals. Shared by the screen and the Excel export. */
export type UsageRow = {
  id: string;
  label: string;
  /** Second column: template for runs, nothing otherwise. */
  detail: string;
  workspace: string;
  calls: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  totalTokens: number;
  hitRate: number | "";
  cost: number;
  unpricedCalls: number;
};

export const day = (iso: string) => iso.slice(0, 10);

function groupKey(e: UsageEvent, view: UsageView): { id: string; label: string; detail: string; workspace: string } {
  const workspace = e.workspace ?? "";
  switch (view) {
    case "day":
      return { id: day(e.createdAt), label: day(e.createdAt), detail: "", workspace: "" };
    case "purpose":
      return { id: e.purpose, label: purposeLabel(e.purpose), detail: "", workspace: "" };
    case "model":
      return { id: e.model, label: modelLabel(e.model), detail: e.model, workspace: "" };
    case "workspace":
      return { id: e.orgKey ?? "-", label: e.workspace || e.orgKey || "No workspace", detail: "", workspace: "" };
    case "run":
      return { id: e.runId ?? "-", label: e.runStartedAt ?? "", detail: e.template ?? "", workspace };
  }
}

export function groupUsage(events: UsageEvent[], view: UsageView): UsageRow[] {
  const groups = new Map<string, { key: ReturnType<typeof groupKey>; events: UsageEvent[] }>();
  for (const e of events) {
    const key = groupKey(e, view);
    const g = groups.get(key.id);
    if (g) g.events.push(e);
    else groups.set(key.id, { key, events: [e] });
  }
  return [...groups.values()].map(({ key, events: es }) => {
    const t = totalsOf(es);
    return {
      ...key,
      calls: t.calls,
      inputTokens: t.inputTokens,
      cacheReadTokens: t.cacheReadTokens,
      cacheWriteTokens: t.cacheWriteTokens,
      outputTokens: t.outputTokens,
      totalTokens: t.totalTokens,
      hitRate: t.hitRate ?? "",
      cost: t.cost,
      unpricedCalls: t.unpricedCalls,
    };
  });
}

/** Cost per day for the chart, every day from `from` to `to` (inclusive), zero-filled. */
export function dailyCost(events: UsageEvent[], from: string, to: string): { day: string; cost: number; calls: number }[] {
  const byDay = new Map<string, { cost: number; calls: number }>();
  for (const e of events) {
    const d = day(e.createdAt);
    const cur = byDay.get(d) ?? { cost: 0, calls: 0 };
    cur.cost += costOf(e.model, e) ?? 0;
    cur.calls += 1;
    byDay.set(d, cur);
  }
  const out: { day: string; cost: number; calls: number }[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end; t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    out.push({ day: d, ...(byDay.get(d) ?? { cost: 0, calls: 0 }) });
  }
  return out;
}

// ─── Runs: is the mapping cache doing its job? ─────────────────────────────────────

export type RunActivity = {
  id: string;
  orgKey: string;
  templateId: string;
  createdAt: string;
  /** Chip questions asked on the run (any kind). */
  questions: number;
  /** Haiku column-mapping calls made for the run. */
  mappingCalls: number;
  hasResult: boolean;
};

export type RunStats = {
  /** Runs started in the period. */
  runs: number;
  /** Runs in the period that reached a report. */
  completed: number;
  /** Completed runs whose workspace had run the same template before. */
  repeats: number;
  /** Repeats that asked no question and made no mapping call. */
  repeatsAskedNothing: number;
  /** repeatsAskedNothing ÷ repeats, or null with no repeats. */
  askedNothingRate: number | null;
};

/**
 * `all` is every run (history decides what counts as a repeat); only runs started at or
 * after `since` are counted.
 */
export function runStats(all: RunActivity[], since?: string): RunStats {
  const sorted = [...all].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  const stats: RunStats = { runs: 0, completed: 0, repeats: 0, repeatsAskedNothing: 0, askedNothingRate: null };
  for (const r of sorted) {
    const key = `${r.orgKey}\u0000${r.templateId}`;
    const repeat = seen.has(key);
    seen.add(key);
    if (since && r.createdAt < since) continue;
    stats.runs += 1;
    if (!r.hasResult) continue;
    stats.completed += 1;
    if (!repeat) continue;
    stats.repeats += 1;
    if (r.questions === 0 && r.mappingCalls === 0) stats.repeatsAskedNothing += 1;
  }
  stats.askedNothingRate = stats.repeats ? stats.repeatsAskedNothing / stats.repeats : null;
  return stats;
}

// ─── Period picker ─────────────────────────────────────────────────────────────────

export const RANGES = [
  { id: "7", label: "Last 7 days", days: 7 },
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "90", label: "Last 90 days", days: 90 },
  { id: "all", label: "All time", days: null },
] as const;

export type RangeId = (typeof RANGES)[number]["id"];

export function parseRange(v: string | null | undefined): RangeId {
  return RANGES.some((r) => r.id === v) ? (v as RangeId) : "30";
}

/** ISO start of the period (UTC midnight, today counted as day one), or undefined for all time. */
export function rangeStart(range: RangeId, now = Date.now()): string | undefined {
  const days = RANGES.find((r) => r.id === range)?.days;
  if (!days) return undefined;
  const today = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`);
  return new Date(today - (days - 1) * 86_400_000).toISOString();
}

/** 0 plus up to four round steps covering `max`. */
export function niceTicks(max: number): number[] {
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) out.push(Number(v.toPrecision(6)));
  return out;
}
