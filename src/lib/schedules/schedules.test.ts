import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRun, saveResult } from "@/lib/runs/store";
import { cadenceLabel, currentDue, defaultRule, firstDue, nextDue, scheduleState, validRule, type ScheduleRule } from "./due";
import * as store from "./store";
import { dueSchedules, scheduleRows } from "./view";

// 2026-11-02 is a Monday.
const weekly = (anchor: number, startsOn = "2026-11-04"): ScheduleRule => ({ cadence: "weekly", anchor, startsOn });
const monthly = (anchor: number, startsOn = "2026-11-04"): ScheduleRule => ({ cadence: "monthly", anchor, startsOn });

describe("due dates", () => {
  it("starts on the first occurrence on or after the day it was made", () => {
    expect(firstDue(weekly(3))).toBe("2026-11-04"); // made on a Wednesday, due Wednesdays
    expect(firstDue(weekly(1))).toBe("2026-11-09"); // next Monday
    expect(firstDue(monthly(1))).toBe("2026-12-01");
    expect(firstDue(monthly(4))).toBe("2026-11-04");
  });

  it("is not due before the first occurrence, then due on it", () => {
    expect(currentDue(weekly(1), "2026-11-08")).toBeNull();
    expect(currentDue(weekly(1), "2026-11-09")).toBe("2026-11-09");
    expect(currentDue(weekly(1), "2026-11-15")).toBe("2026-11-09");
    expect(currentDue(weekly(1), "2026-11-16")).toBe("2026-11-16");
  });

  it("clamps day 29–31 to the end of short months, leap years included", () => {
    const r = monthly(31, "2027-01-01");
    expect(firstDue(r)).toBe("2027-01-31");
    expect(nextDue(r, "2027-01-31")).toBe("2027-02-28");
    expect(nextDue(r, "2027-02-28")).toBe("2027-03-31");
    expect(currentDue(r, "2027-03-15")).toBe("2027-02-28");
    expect(nextDue(monthly(30, "2028-02-01"), "2028-02-01")).toBe("2028-02-29");
  });

  it("rolls over year ends", () => {
    expect(nextDue(monthly(15, "2026-12-20"), "2026-12-20")).toBe("2027-01-15");
    expect(nextDue(weekly(4, "2026-12-30"), "2026-12-31")).toBe("2027-01-07");
  });

  it("validates rules and labels them", () => {
    expect(validRule("weekly", 7)).toBe(true);
    expect(validRule("weekly", 8)).toBe(false);
    expect(validRule("monthly", 31)).toBe(true);
    expect(validRule("monthly", 0)).toBe(false);
    expect(validRule("daily", 1)).toBe(false);
    expect(validRule("monthly", 1.5)).toBe(false);
    expect(cadenceLabel({ cadence: "weekly", anchor: 1 })).toBe("Every Monday");
    expect(cadenceLabel({ cadence: "monthly", anchor: 2 })).toBe("Monthly, on the 2nd");
    expect(cadenceLabel({ cadence: "monthly", anchor: 31 })).toBe("Monthly, on the 31st (or the last day)");
    expect(defaultRule("monthly")).toEqual({ cadence: "monthly", anchor: 1 });
    expect(defaultRule("per_settlement")).toEqual({ cadence: "weekly", anchor: 1 });
  });
});

describe("schedule state", () => {
  const r = { ...weekly(1), paused: false };

  it("is up to date before the first due date", () => {
    expect(scheduleState(r, [], "2026-11-05")).toEqual({ state: "done", dueOn: null, runId: null, nextOn: "2026-11-09" });
  });

  it("is due with no run for the period, counting days late", async () => {
    expect(scheduleState(r, [], "2026-11-11")).toEqual({ state: "due", dueOn: "2026-11-09", daysLate: 2 });
    // A run for an earlier period doesn't cover this one.
    expect(scheduleState(r, [{ id: "a", period: "2026-11-02", done: true }], "2026-11-11").state).toBe("due");
  });

  it("is in progress until the period's run has a report, then up to date", () => {
    expect(scheduleState(r, [{ id: "a", period: "2026-11-09", done: false }], "2026-11-10")).toEqual({ state: "started", dueOn: "2026-11-09", runId: "a" });
    expect(scheduleState(r, [{ id: "a", period: "2026-11-09", done: true }], "2026-11-10")).toEqual({ state: "done", dueOn: "2026-11-09", runId: "a", nextOn: "2026-11-16" });
  });

  it("is paused regardless of due dates", () => {
    expect(scheduleState({ ...r, paused: true }, [], "2026-11-11")).toEqual({ state: "paused", nextOn: "2026-11-16" });
  });
});

describe("schedule store and rows", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "sawwi-schedules-"));
    process.env.SAWWI_DATA_DIR = dir;
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("scopes schedules to the workspace and tracks the period's run", async () => {
    const now = Date.parse("2026-11-11T09:00:00Z");
    const s = await store.createSchedule({ orgKey: "acme", templateId: "mkt-settlement-vs-sales", cadence: "weekly", anchor: 1, startsOn: "2026-11-02", createdBy: null });
    await store.createSchedule({ orgKey: "other", templateId: "mkt-settlement-vs-sales", cadence: "monthly", anchor: 1, startsOn: "2026-11-02", createdBy: null });

    expect(await store.getSchedule("other", s.id)).toBeUndefined();
    expect(await store.listSchedules("acme")).toHaveLength(1);

    let [row] = await scheduleRows("acme", now);
    expect(row).toMatchObject({ status: "Due", when: "2026-11-09", daysLate: 2, runs: 0, cadence: "Every Monday" });
    expect(row.template).not.toBe("mkt-settlement-vs-sales");
    expect(await dueSchedules("acme", now)).toHaveLength(1);

    const run = await createRun("acme", s.templateId);
    await store.linkRunToSchedule(run.id, s.id, "2026-11-09");
    [row] = await scheduleRows("acme", now);
    expect(row).toMatchObject({ status: "In progress", runId: run.id, runs: 1 });

    await saveResult(run.id, { totals: { exceptions: 0, value: 0 } } as never);
    [row] = await scheduleRows("acme", now);
    expect(row).toMatchObject({ status: "Up to date", when: "2026-11-16", runId: run.id });
    expect(await dueSchedules("acme", now)).toHaveLength(0);

    await store.setSchedulePaused("other", s.id, true); // wrong workspace: no effect
    expect((await store.getSchedule("acme", s.id))!.paused).toBe(false);
    await store.setSchedulePaused("acme", s.id, true);
    expect((await scheduleRows("acme", now))[0].status).toBe("Paused");

    await store.deleteSchedule("acme", s.id);
    expect(await store.listSchedules("acme")).toHaveLength(0);
  });
});
