import { isDemoOrg } from "@/lib/demo/demo";
import { getOrgByKey } from "@/lib/saas/store";
import { scheduleRows } from "@/lib/schedules/view";
import { orgsWithActiveSchedules } from "@/lib/schedules/store";
import { queueEmail } from "./queue";
import { recipients } from "./store";

// Emailed reminders for schedules that came due (D-26, D-45). The `schedule_reminders` job runs
// every hour; each reminder's key is the schedule, the period and the person, so a period is
// mailed once however many sweeps see it. Only a period nobody has started is a reminder: once
// someone starts the run, the team can see it in Due now.

/** Older periods aren't mailed: they were due before reminders existed, or the next one is close. */
export const REMINDER_WINDOW_DAYS = 7;
/** Who runs reconciliations: owners, admins and editors. Viewers can't start one. */
export const REMINDER_ROLES = ["owner", "admin", "editor"];

export async function queueDueReminders(now: Date): Promise<{ queued: number }> {
  let queued = 0;
  for (const orgKey of await orgsWithActiveSchedules()) {
    if (isDemoOrg(orgKey)) continue;
    const due = (await scheduleRows(orgKey, now.getTime())).filter((r) => r.state === "due" && typeof r.daysLate === "number" && r.daysLate <= REMINDER_WINDOW_DAYS);
    if (due.length === 0) continue;
    const org = await getOrgByKey(orgKey);
    if (!org) continue;
    const people = await recipients(orgKey, REMINDER_ROLES, "reminders");
    for (const row of due) {
      for (const person of people) {
        const isNew = await queueEmail(
          `email:reminder:${row.id}:${row.when}:${person.userId}`,
          {
            to: person.email,
            userId: person.userId,
            topic: "reminders",
            template: "reminder",
            data: { name: person.name, workspace: org.name, template: row.template, cadence: row.cadence, dueOn: row.when },
          },
          now,
        );
        if (isNew) queued++;
      }
    }
  }
  return { queued };
}
