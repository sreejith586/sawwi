import type { SheetColumn } from "@/lib/excel/sheet";
import { listRunActivity, listUsageRecords } from "@/lib/runs/store";
import { templateFor } from "@/lib/runs/templates";
import { MODEL_PRICES, PRICES_AS_OF, PRICES_SOURCE } from "./pricing";
import { dailyCost, day, groupUsage, rangeStart, runStats, totalsOf, type RangeId, type UsageEvent, type UsageView } from "./aggregate";

// Server-side: builds the usage dashboard for one workspace (orgKey) or, for the
// superadmin console, all of them (null). The page and its Excel export share it.

export async function usageEvents(orgKey: string | null, range: RangeId): Promise<UsageEvent[]> {
  const records = await listUsageRecords(orgKey, rangeStart(range));
  // One template lookup per run, not per call.
  const titles = new Map<string, string>();
  for (const r of records) {
    if (!r.orgKey || !r.templateId || !r.runId || titles.has(r.runId)) continue;
    titles.set(r.runId, (await templateFor(r.orgKey, r.templateId, r.runId))?.title ?? r.templateId);
  }
  return records.map((r) => ({
    runId: r.runId,
    orgKey: r.orgKey,
    workspace: r.orgName ?? r.orgKey ?? undefined,
    template: r.runId ? titles.get(r.runId) : undefined,
    runStartedAt: r.runStartedAt ?? undefined,
    purpose: r.purpose,
    model: r.model,
    inputTokens: r.inputTokens,
    cacheReadTokens: r.cacheReadTokens,
    cacheWriteTokens: r.cacheWriteTokens,
    outputTokens: r.outputTokens,
    createdAt: r.createdAt,
  }));
}

export async function usageReport(orgKey: string | null, range: RangeId, now = Date.now()) {
  const events = await usageEvents(orgKey, range);
  const since = rangeStart(range, now);
  const today = new Date(now).toISOString().slice(0, 10);
  const first = since ? day(since) : events[0] ? day(events[0].createdAt) : today;
  return {
    totals: totalsOf(events),
    runs: runStats(await listRunActivity(orgKey), since),
    daily: dailyCost(events, first, today),
    events,
  };
}

export const USAGE_VIEWS: UsageView[] = ["day", "purpose", "model", "run", "workspace"];

export function parseView(v: string | null, admin: boolean): UsageView {
  const view = USAGE_VIEWS.find((x) => x === v) ?? "day";
  return view === "workspace" && !admin ? "day" : view;
}

// Client-safe keys live in ./columns; the Excel columns per view are here.
const TOKEN_COLUMNS: SheetColumn[] = [
  { header: "Calls", key: "calls", type: "number" },
  { header: "Input tokens", key: "inputTokens", type: "number" },
  { header: "Cache read tokens", key: "cacheReadTokens", type: "number" },
  { header: "Cache write tokens", key: "cacheWriteTokens", type: "number" },
  { header: "Output tokens", key: "outputTokens", type: "number" },
  { header: "Total tokens", key: "totalTokens", type: "number" },
  { header: "Cache hit rate", key: "hitRate", type: "number", numFmt: "0.0%" },
  { header: "Estimated cost (USD)", key: "cost", type: "number", numFmt: "$#,##0.0000" },
  { header: "Calls without a price", key: "unpricedCalls", type: "number" },
];

export function usageSheetColumns(view: UsageView, admin: boolean): SheetColumn[] {
  const first: Record<UsageView, SheetColumn[]> = {
    day: [{ header: "Day", key: "label", type: "date" }],
    purpose: [{ header: "Purpose", key: "label" }],
    model: [
      { header: "Model", key: "label" },
      { header: "Model id", key: "detail" },
    ],
    run: [
      { header: "Run started", key: "label", type: "date" },
      { header: "Reconciliation", key: "detail", width: 40 },
      ...(admin ? [{ header: "Workspace", key: "workspace" }] : []),
      { header: "Run id", key: "id" },
    ],
    workspace: [{ header: "Workspace", key: "label" }],
  };
  return [...first[view], ...TOKEN_COLUMNS];
}

export { groupUsage };

/** Everything the dashboard component shows, for one workspace or (null) all of them. */
export async function dashboardData(orgKey: string | null, range: RangeId) {
  const admin = orgKey === null;
  const { totals, runs, daily, events } = await usageReport(orgKey, range);
  const views = USAGE_VIEWS.filter((v) => admin || v !== "workspace");
  const rows = Object.fromEntries(USAGE_VIEWS.map((v) => [v, views.includes(v) ? groupUsage(events, v) : []])) as Record<UsageView, ReturnType<typeof groupUsage>>;
  return {
    totals,
    runs,
    daily,
    rows,
    prices: { asOf: PRICES_AS_OF, source: PRICES_SOURCE, models: Object.entries(MODEL_PRICES).map(([id, p]) => ({ id, ...p })) },
  };
}
