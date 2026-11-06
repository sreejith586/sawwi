"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { createRun } from "@/lib/runs/store";
import { templateFor } from "@/lib/runs/templates";
import { canRun, getCurrentSession, runBlocker } from "@/lib/saas/session";
import { currentDue, isoDay, scheduleState, validRule } from "@/lib/schedules/due";
import * as store from "@/lib/schedules/store";
import { GENERIC_TEMPLATE_ID } from "@/lib/templates/custom";

// Scheduled reconciliations (D-26). Making a schedule or starting its run is new work, so
// it goes through runBlocker() (role, plan, trial, suspension). Pausing or deleting one
// only needs edit rights. Viewers can see schedules but change nothing.

export type ScheduleActionState = { error?: string };

/** Form action on a template page: { cadence, anchor }. */
export async function createScheduleAction(templateId: string, _prev: ScheduleActionState, form: FormData): Promise<ScheduleActionState> {
  const blocked = await runBlocker();
  if (blocked) return { error: blocked.message };
  const session = (await getCurrentSession())!;
  const orgKey = session.org.key;
  if (templateId === GENERIC_TEMPLATE_ID || !templateFor(orgKey, templateId)) return { error: "That template can't be scheduled." };
  const cadence = String(form.get("cadence") ?? "");
  const anchor = Number(form.get("anchor"));
  if (!validRule(cadence, anchor)) return { error: "Pick how often and on which day." };
  if (store.listSchedules(orgKey).some((s) => s.templateId === templateId && s.cadence === cadence && s.anchor === anchor)) {
    return { error: "This template already has that schedule." };
  }
  store.createSchedule({ orgKey, templateId, cadence, anchor, startsOn: isoDay(Date.now()), createdBy: session.user.id });
  redirect("/schedules");
}

/**
 * Starts this period's run of a due schedule, or opens it if it was started already, so a
 * double click never creates (or bills) two runs. The run is an ordinary run: saved
 * mappings for the same file layouts apply, so a repeat asks nothing.
 */
export async function startScheduledRun(scheduleId: string) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  const schedule = store.getSchedule(session.org.key, scheduleId);
  if (!schedule) redirect("/schedules");
  const today = isoDay(Date.now());
  const state = scheduleState(schedule, store.listScheduledRuns(session.org.key).filter((r) => r.scheduleId === schedule.id), today);
  if (state.state === "started") redirect(`/runs/${state.runId}`);
  const period = currentDue(schedule, today);
  if (state.state !== "due" || !period) redirect("/schedules");
  const blocked = await runBlocker();
  if (blocked) redirect(`/settings/billing?blocked=${blocked.reason}`);
  const run = createRun(session.org.key, schedule.templateId);
  store.linkRunToSchedule(run.id, schedule.id, period);
  redirect(`/runs/${run.id}`);
}

async function editor(): Promise<string | undefined> {
  const session = await getCurrentSession();
  return session && canRun(session.access) ? session.org.key : undefined;
}

export async function setSchedulePaused(scheduleId: string, paused: boolean) {
  const orgKey = await editor();
  if (!orgKey) return;
  store.setSchedulePaused(orgKey, scheduleId, paused);
  refresh();
}

export async function deleteScheduleAction(scheduleId: string) {
  const orgKey = await editor();
  if (!orgKey) return;
  store.deleteSchedule(orgKey, scheduleId);
  refresh();
}
