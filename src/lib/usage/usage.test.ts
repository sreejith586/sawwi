import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as store from "@/lib/runs/store";
import { createOrg } from "@/lib/saas/store";
import { dailyCost, groupUsage, hitRate, niceTicks, parseRange, rangeStart, runStats, totalsOf, type RunActivity, type UsageEvent } from "./aggregate";
import { costOf, MODEL_PRICES, priceFor } from "./pricing";
import { dashboardData } from "./report";

const ev = (over: Partial<UsageEvent>): UsageEvent => ({
  runId: "r1",
  orgKey: "acme",
  purpose: "chat",
  model: "claude-haiku-5-5",
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  createdAt: "2026-11-01T10:00:00.000Z",
  ...over,
});

describe("pricing", () => {
  it("prices every token kind per million", () => {
    // Sonnet 5.5: $2 in, $0.20 cache read, $4 cache write (1h), $10 out.
    expect(costOf("claude-sonnet-5-5", { inputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 })).toBeCloseTo(2);
    expect(costOf("claude-sonnet-5-5", { inputTokens: 1000, cacheReadTokens: 10_000, cacheWriteTokens: 2000, outputTokens: 500 })).toBeCloseTo(
      (1000 * 2 + 10_000 * 0.2 + 2000 * 4 + 500 * 10) / 1e6,
    );
    expect(costOf("claude-haiku-5-5", { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 2_000_000 })).toBeCloseTo(1);
  });

  it("matches a dated snapshot to its model, but not a shorter id to a longer one", () => {
    expect(priceFor("claude-sonnet-5-5-20261001")?.label).toBe("Sonnet 5.5");
    expect(priceFor("claude-opus-5")).toBeUndefined();
    expect(costOf("gpt-x", { inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 })).toBeNull();
  });

  it("keeps cache reads cheaper than input and 1h writes at 2x input", () => {
    for (const p of Object.values(MODEL_PRICES)) {
      expect(p.cacheRead).toBeLessThan(p.input);
      expect(p.cacheWrite).toBeCloseTo(p.input * 2);
    }
  });
});

describe("aggregation", () => {
  const events = [
    ev({ purpose: "column_mapping", inputTokens: 300, cacheWriteTokens: 2000, outputTokens: 100, createdAt: "2026-11-01T08:00:00Z" }),
    ev({ purpose: "chat", inputTokens: 200, cacheReadTokens: 2000, outputTokens: 50, createdAt: "2026-11-01T09:00:00Z" }),
    ev({ purpose: "narrative", model: "claude-sonnet-5-5", runId: "r2", inputTokens: 100, cacheReadTokens: 3000, outputTokens: 400, createdAt: "2026-11-03T09:00:00Z" }),
    ev({ purpose: "chat", model: "some-new-model", runId: "r2", inputTokens: 10, createdAt: "2026-11-03T10:00:00Z" }),
  ];

  it("totals tokens, cost and the cache hit rate", () => {
    const t = totalsOf(events);
    expect(t.calls).toBe(4);
    expect(t.inputTokens).toBe(610);
    expect(t.cacheReadTokens).toBe(5000);
    expect(t.totalTokens).toBe(610 + 5000 + 2000 + 550);
    expect(t.hitRate).toBeCloseTo(5000 / (610 + 5000 + 2000));
    expect(t.unpricedCalls).toBe(1);
    const priced = events.slice(0, 3).reduce((s, e) => s + costOf(e.model, e)!, 0);
    expect(t.cost).toBeCloseTo(priced);
  });

  it("has no hit rate without prompt tokens", () => {
    expect(hitRate({ inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 5 })).toBeNull();
    expect(totalsOf([]).hitRate).toBeNull();
  });

  it("groups by day, purpose, model and run", () => {
    expect(groupUsage(events, "day").map((r) => [r.label, r.calls])).toEqual([
      ["2026-11-01", 2],
      ["2026-11-03", 2],
    ]);
    const purpose = groupUsage(events, "purpose");
    expect(purpose.find((r) => r.id === "chat")).toMatchObject({ label: "Chat answer", calls: 2, unpricedCalls: 1 });
    expect(groupUsage(events, "model").map((r) => r.label).sort()).toEqual(["Haiku 5.5", "Sonnet 5.5", "some-new-model"]);
    const runs = groupUsage(events.map((e) => ({ ...e, template: e.runId === "r1" ? "Payouts vs orders" : "Bank vs ledger" })), "run");
    expect(runs.map((r) => [r.id, r.detail, r.calls])).toEqual([
      ["r1", "Payouts vs orders", 2],
      ["r2", "Bank vs ledger", 2],
    ]);
  });

  it("zero-fills the daily chart", () => {
    expect(dailyCost(events, "2026-10-31", "2026-11-03").map((d) => [d.day, d.calls])).toEqual([
      ["2026-10-31", 0],
      ["2026-11-01", 2],
      ["2026-11-02", 0],
      ["2026-11-03", 2],
    ]);
  });

  it("picks round chart ticks", () => {
    expect(niceTicks(9)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(niceTicks(0.031)).toEqual([0, 0.01, 0.02, 0.03, 0.04]);
  });

  it("parses the period and starts it at UTC midnight", () => {
    expect(parseRange("90")).toBe("90");
    expect(parseRange("bogus")).toBe("30");
    expect(rangeStart("7", Date.parse("2026-11-06T15:00:00Z"))).toBe("2026-10-31T00:00:00.000Z");
    expect(rangeStart("all")).toBeUndefined();
  });
});

describe("repeat runs that asked nothing", () => {
  const run = (over: Partial<RunActivity>): RunActivity => ({ id: "x", orgKey: "acme", templateId: "t1", createdAt: "2026-11-01T00:00:00Z", questions: 0, mappingCalls: 0, hasResult: true, ...over });

  it("counts a run as a repeat when its workspace ran the template before", () => {
    const s = runStats([
      run({ id: "a", createdAt: "2026-10-01T00:00:00Z", questions: 4, mappingCalls: 1 }),
      run({ id: "b", createdAt: "2026-10-08T00:00:00Z" }),
      run({ id: "c", createdAt: "2026-10-15T00:00:00Z", questions: 1 }),
      run({ id: "d", createdAt: "2026-10-16T00:00:00Z", orgKey: "other" }),
      run({ id: "e", createdAt: "2026-10-17T00:00:00Z", hasResult: false }),
      run({ id: "f", createdAt: "2026-10-18T00:00:00Z", templateId: "t2" }),
    ]);
    expect(s).toEqual({ runs: 6, completed: 5, repeats: 2, repeatsAskedNothing: 1, askedNothingRate: 0.5 });
  });

  it("uses history before the period to spot repeats but counts only runs in it", () => {
    const s = runStats([run({ id: "a", createdAt: "2026-09-01T00:00:00Z", questions: 3 }), run({ id: "b", createdAt: "2026-11-02T00:00:00Z" })], "2026-11-01T00:00:00Z");
    expect(s).toMatchObject({ runs: 1, repeats: 1, repeatsAskedNothing: 1, askedNothingRate: 1 });
    expect(runStats([]).askedNothingRate).toBeNull();
  });
});

describe("usage store", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "sawwi-usage-"));
    process.env.SAWWI_DATA_DIR = dir;
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("scopes usage to the workspace and lists every workspace for admins", async () => {
    const a = await createOrg("Acme Trading", 14);
    const b = await createOrg("Bravo Retail", 14);
    const runA = await store.createRun(a.key, "mkt-settlement-vs-sales");
    const runB = await store.createRun(b.key, "mkt-settlement-vs-sales");
    await store.logUsage(runA.id, "column_mapping", { model: "claude-haiku-5-5", inputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 3000, outputTokens: 120 });
    await store.logUsage(runA.id, "narrative", { model: "claude-sonnet-5-5", inputTokens: 200, cacheReadTokens: 2500, cacheWriteTokens: 0, outputTokens: 600 });
    await store.logUsage(runB.id, "chat", { model: "claude-haiku-5-5", inputTokens: 50, cacheReadTokens: 900, cacheWriteTokens: 0, outputTokens: 80 });
    await store.addQuestion(runA.id, "orders", { kind: "currency", options: ["AED"] });

    const mine = await store.listUsageRecords(a.key);
    expect(mine.map((r) => r.purpose)).toEqual(["column_mapping", "narrative"]);
    expect(mine.every((r) => r.orgKey === a.key)).toBe(true);
    expect(await store.listUsageRecords(b.key)).toHaveLength(1);
    const all = await store.listUsageRecords(null);
    expect(all).toHaveLength(3);
    expect(new Set(all.map((r) => r.orgName))).toEqual(new Set(["Acme Trading", "Bravo Retail"]));
    expect(await store.listUsageRecords(a.key, "2999-01-01T00:00:00Z")).toHaveLength(0);

    const activity = await store.listRunActivity(a.key);
    expect(activity).toEqual([expect.objectContaining({ id: runA.id, questions: 1, mappingCalls: 1, hasResult: false })]);

    const dash = await dashboardData(a.key, "30");
    expect(dash.totals.calls).toBe(2);
    expect(dash.rows.workspace).toEqual([]);
    expect(dash.rows.run[0]).toMatchObject({ id: runA.id, calls: 2 });
    expect(dash.rows.run[0].detail).not.toBe("mkt-settlement-vs-sales");
    expect((await dashboardData(null, "all")).rows.workspace.map((r) => r.label).sort()).toEqual(["Acme Trading", "Bravo Retail"]);
  });
});
