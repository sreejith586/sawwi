import { templateFor } from "@/lib/runs/templates";
import { GROUP_LABELS } from "@/lib/templates/types";
import { cadenceLabel, isoDay, scheduleState, type ScheduleState } from "./due";
import { listScheduledRuns, listSchedules } from "./store";

// Server-side rows for the Schedules page, the Home inbox and the Excel export.

export type ScheduleRow = {
  id: string;
  templateId: string;
  template: string;
  group: string;
  cadence: string;
  /** "Due", "In progress", "Up to date" or "Paused". */
  status: string;
  /** Sort key: the due date if due, else the next date. */
  when: string;
  daysLate: number | "";
  /** The run for the current period, if one was started. */
  runId: string;
  runs: number;
  lastRunAt: string;
  paused: boolean;
  state: ScheduleState["state"];
};

export const SCHEDULE_STATUS: Record<ScheduleState["state"], string> = { due: "Due", started: "In progress", done: "Up to date", paused: "Paused" };

export function scheduleRows(orgKey: string, now = Date.now()): ScheduleRow[] {
  const today = isoDay(now);
  const runs = listScheduledRuns(orgKey);
  return listSchedules(orgKey).map((s) => {
    const mine = runs.filter((r) => r.scheduleId === s.id);
    const st = scheduleState(s, mine, today);
    const t = templateFor(orgKey, s.templateId);
    return {
      id: s.id,
      templateId: s.templateId,
      template: t?.title ?? s.templateId,
      group: t ? GROUP_LABELS[t.group] : "",
      cadence: cadenceLabel(s),
      status: SCHEDULE_STATUS[st.state],
      when: st.state === "due" || st.state === "started" ? st.dueOn : st.nextOn,
      daysLate: st.state === "due" ? st.daysLate : "",
      runId: st.state === "started" || st.state === "done" ? (st.runId ?? "") : "",
      runs: mine.length,
      lastRunAt: mine.length ? mine[mine.length - 1].createdAt : "",
      paused: s.paused,
      state: st.state,
    };
  });
}

/** Schedules that need someone to upload this period's files, most overdue first. */
export function dueSchedules(orgKey: string, now = Date.now()): ScheduleRow[] {
  return scheduleRows(orgKey, now)
    .filter((r) => r.state === "due" || r.state === "started")
    .sort((a, b) => a.when.localeCompare(b.when));
}
