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

export async function createSchedule(s: Omit<Schedule, "id" | "paused" | "createdAt">): Promise<Schedule> {
  const schedule: Schedule = { ...s, id: randomUUID(), paused: false, createdAt: new Date().toISOString() };
  await getDb().run("INSERT INTO schedules (id, org_key, template_id, cadence, anchor, starts_on, paused, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)", schedule.id, s.orgKey, s.templateId, s.cadence, s.anchor, s.startsOn, s.createdBy, schedule.createdAt);
  return schedule;
}

/** Scoped by workspace: a schedule id from another workspace returns nothing. */
export async function getSchedule(orgKey: string, id: string): Promise<Schedule | undefined> {
  const r = (await getDb().get("SELECT * FROM schedules WHERE id = ? AND org_key = ?", id, orgKey)) as Row | undefined;
  return r ? toSchedule(r) : undefined;
}

export async function listSchedules(orgKey: string): Promise<Schedule[]> {
  return ((await getDb().all("SELECT * FROM schedules WHERE org_key = ? ORDER BY created_at", orgKey)) as Row[]).map(toSchedule);
}

export async function setSchedulePaused(orgKey: string, id: string, paused: boolean) {
  await getDb().run("UPDATE schedules SET paused = ? WHERE id = ? AND org_key = ?", paused ? 1 : 0, id, orgKey);
}

/** Deleting a schedule keeps its runs; they just stop pointing at a live schedule. */
export async function deleteSchedule(orgKey: string, id: string) {
  await getDb().run("DELETE FROM schedules WHERE id = ? AND org_key = ?", id, orgKey);
}

export async function linkRunToSchedule(runId: string, scheduleId: string, period: string) {
  await getDb().run("UPDATE runs SET schedule_id = ?, schedule_period = ? WHERE id = ?", scheduleId, period, runId);
}

/** Runs started from the workspace's schedules, oldest first. */
export async function listScheduledRuns(orgKey: string): Promise<ScheduledRun[]> {
  const rows = (await getDb().all(`SELECT r.id, r.schedule_id, r.schedule_period, r.created_at, EXISTS (SELECT 1 FROM run_results rr WHERE rr.run_id = r.id) AS done
       FROM runs r WHERE r.org_key = ? AND r.schedule_id IS NOT NULL ORDER BY r.created_at`, orgKey)) as Row[];
  return rows.map((r) => ({ id: String(r.id), scheduleId: String(r.schedule_id), period: String(r.schedule_period), done: Number(r.done) === 1, createdAt: String(r.created_at) }));
}

/** Workspaces with at least one live schedule: what the reminder sweep looks at (D-45). */
export async function orgsWithActiveSchedules(): Promise<string[]> {
  return ((await getDb().all("SELECT DISTINCT org_key FROM schedules WHERE paused = 0 ORDER BY org_key")) as Row[]).map((r) => String(r.org_key));
}
