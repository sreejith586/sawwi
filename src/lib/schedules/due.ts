// Due-date maths for scheduled reconciliations (D-26). Pure, no DB: dates are ISO days
// ("2026-11-06") in UTC, so a schedule means the same day for every teammate.

export type Cadence = "weekly" | "monthly";

export type ScheduleRule = {
  cadence: Cadence;
  /** Weekly: ISO weekday, 1 = Monday … 7 = Sunday. Monthly: day of month, 1–31 (clamped to the month's last day). */
  anchor: number;
  /** ISO day the schedule was created; the first due date is on or after it. */
  startsOn: string;
};

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

const DAY = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const isoDay = (date: Date | number | string) => (typeof date === "string" ? date.slice(0, 10) : toDay(typeof date === "number" ? date : date.getTime()));

export function validRule(cadence: string, anchor: number): cadence is Cadence {
  if (cadence === "weekly") return Number.isInteger(anchor) && anchor >= 1 && anchor <= 7;
  if (cadence === "monthly") return Number.isInteger(anchor) && anchor >= 1 && anchor <= 31;
  return false;
}

function monthlyDate(year: number, month: number, anchor: number): string {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return toDay(Date.UTC(year, month, Math.min(anchor, last)));
}

/** The latest occurrence of the rule on or before `day` (ignoring startsOn). */
function occurrenceOnOrBefore(rule: ScheduleRule, day: string): string {
  const ms = toMs(day);
  if (rule.cadence === "weekly") {
    const iso = ((new Date(ms).getUTCDay() + 6) % 7) + 1;
    return toDay(ms - ((iso - rule.anchor + 7) % 7) * DAY);
  }
  const d = new Date(ms);
  const thisMonth = monthlyDate(d.getUTCFullYear(), d.getUTCMonth(), rule.anchor);
  return thisMonth <= day ? thisMonth : monthlyDate(d.getUTCFullYear(), d.getUTCMonth() - 1, rule.anchor);
}

/** The first occurrence strictly after `day`. */
function occurrenceAfter(rule: ScheduleRule, day: string): string {
  if (rule.cadence === "weekly") return toDay(toMs(occurrenceOnOrBefore(rule, day)) + 7 * DAY);
  const d = new Date(toMs(day));
  const thisMonth = monthlyDate(d.getUTCFullYear(), d.getUTCMonth(), rule.anchor);
  return thisMonth > day ? thisMonth : monthlyDate(d.getUTCFullYear(), d.getUTCMonth() + 1, rule.anchor);
}

/** First due date: the first occurrence on or after the day the schedule was made. */
export function firstDue(rule: ScheduleRule): string {
  const prev = occurrenceOnOrBefore(rule, rule.startsOn);
  return prev === rule.startsOn ? prev : occurrenceAfter(rule, rule.startsOn);
}

/** The period that is due as of `today`: the latest occurrence on or before it, or null before the first one. */
export function currentDue(rule: ScheduleRule, today: string): string | null {
  const first = firstDue(rule);
  if (today < first) return null;
  return occurrenceOnOrBefore(rule, today);
}

/** The next occurrence after `today`. */
export function nextDue(rule: ScheduleRule, today: string): string {
  const first = firstDue(rule);
  return today < first ? first : occurrenceAfter(rule, today);
}

export type ScheduleState =
  | { state: "paused"; nextOn: string }
  /** The current period has no run yet. `runId` is set when one was started but not finished. */
  | { state: "due"; dueOn: string; daysLate: number }
  | { state: "started"; dueOn: string; runId: string }
  | { state: "done"; dueOn: string | null; runId: string | null; nextOn: string };

/**
 * Where a schedule stands today, given the runs started from it (period = the due date
 * each was started for, done = it reached a report).
 */
export function scheduleState(rule: ScheduleRule & { paused: boolean }, runs: { id: string; period: string; done: boolean }[], today: string): ScheduleState {
  if (rule.paused) return { state: "paused", nextOn: nextDue(rule, today) };
  const due = currentDue(rule, today);
  const forPeriod = due ? runs.filter((r) => r.period === due) : [];
  if (due && forPeriod.length === 0) return { state: "due", dueOn: due, daysLate: Math.round((toMs(today) - toMs(due)) / DAY) };
  if (due && !forPeriod.some((r) => r.done)) return { state: "started", dueOn: due, runId: forPeriod[forPeriod.length - 1].id };
  const done = forPeriod.find((r) => r.done);
  return { state: "done", dueOn: due, runId: done?.id ?? null, nextOn: nextDue(rule, today) };
}

export function cadenceLabel(rule: Pick<ScheduleRule, "cadence" | "anchor">): string {
  if (rule.cadence === "weekly") return `Every ${WEEKDAYS[rule.anchor - 1]}`;
  const n = rule.anchor;
  const suffix = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
  return n >= 29 ? `Monthly, on the ${n}${suffix} (or the last day)` : `Monthly, on the ${n}${suffix}`;
}

/** A sensible default from the template's usual frequency. */
export function defaultRule(frequency: string): { cadence: Cadence; anchor: number } {
  return frequency === "monthly" ? { cadence: "monthly", anchor: 1 } : { cadence: "weekly", anchor: 1 };
}
