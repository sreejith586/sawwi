import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import type { Cadence } from "./due";

// All SQL for scheduled reconciliations (D-26) lives here.

type Row = Record<string, string | number | null>;

export type Schedule = {
  id: string;
  orgKey: string;
  templateId: string;
  cadence: Cadence;
  anchor: number;
  startsOn: string;
  paused: boolean;
  createdBy: string | null;
  createdAt: string;
};

export type ScheduledRun = { id: string; scheduleId: string; period: string; done: boolean; createdAt: string };

const toSchedule = (r: Row): Schedule => ({
  id: String(r.id),
  orgKey: String(r.org_key),
  templateId: String(r.template_id),
  cadence: r.cadence as Cadence,
  anchor: Number(r.anchor),
  startsOn: String(r.starts_on),
  paused: Number(r.paused) === 1,
  createdBy: r.created_by === null ? null : String(r.created_by),
  createdAt: String(r.created_at),
});

export function createSchedule(s: Omit<Schedule, "id" | "paused" | "createdAt">): Schedule {
  const schedule: Schedule = { ...s, id: randomUUID(), paused: false, createdAt: new Date().toISOString() };
  getDb()
    .prepare("INSERT INTO schedules (id, org_key, template_id, cadence, anchor, starts_on, paused, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)")
    .run(schedule.id, s.orgKey, s.templateId, s.cadence, s.anchor, s.startsOn, s.createdBy, schedule.createdAt);
  return schedule;
}

/** Scoped by workspace: a schedule id from another workspace returns nothing. */
export function getSchedule(orgKey: string, id: string): Schedule | undefined {
  const r = getDb().prepare("SELECT * FROM schedules WHERE id = ? AND org_key = ?").get(id, orgKey) as Row | undefined;
  return r ? toSchedule(r) : undefined;
}

export function listSchedules(orgKey: string): Schedule[] {
  return (getDb().prepare("SELECT * FROM schedules WHERE org_key = ? ORDER BY created_at").all(orgKey) as Row[]).map(toSchedule);
}

export function setSchedulePaused(orgKey: string, id: string, paused: boolean) {
  getDb().prepare("UPDATE schedules SET paused = ? WHERE id = ? AND org_key = ?").run(paused ? 1 : 0, id, orgKey);
}

/** Deleting a schedule keeps its runs; they just stop pointing at a live schedule. */
export function deleteSchedule(orgKey: string, id: string) {
  getDb().prepare("DELETE FROM schedules WHERE id = ? AND org_key = ?").run(id, orgKey);
}

export function linkRunToSchedule(runId: string, scheduleId: string, period: string) {
  getDb().prepare("UPDATE runs SET schedule_id = ?, schedule_period = ? WHERE id = ?").run(scheduleId, period, runId);
}

/** Runs started from the workspace's schedules, oldest first. */
export function listScheduledRuns(orgKey: string): ScheduledRun[] {
  const rows = getDb()
    .prepare(
      `SELECT r.id, r.schedule_id, r.schedule_period, r.created_at, EXISTS (SELECT 1 FROM run_results rr WHERE rr.run_id = r.id) AS done
       FROM runs r WHERE r.org_key = ? AND r.schedule_id IS NOT NULL ORDER BY r.created_at`,
    )
    .all(orgKey) as Row[];
  return rows.map((r) => ({ id: String(r.id), scheduleId: String(r.schedule_id), period: String(r.schedule_period), done: Number(r.done) === 1, createdAt: String(r.created_at) }));
}
