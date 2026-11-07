import { isDemoOrg } from "@/lib/demo/demo";
import { money } from "@/lib/insights/facts";
import type { ReconResult } from "@/lib/recon/match";
import { getOrgByKey } from "@/lib/saas/store";
import { templateForRun } from "@/lib/runs/templates";
import type { Run } from "@/lib/runs/types";
import { queueEmail } from "./queue";
import { recipients } from "./store";

// "Ready to review" (D-45): when a reconciliation finishes, the rest of the workspace hears about
// it, with the exception count and value. The person who ran it is looking at the report already,
// so they're left out. One notice per run and person: re-running after a fix doesn't mail again.

export const NOTICE_ROLES = ["owner", "admin", "editor", "viewer"];

/** Queues the notices and returns their job keys (pass them to `sendSoon`). */
export async function queueReadyNotices(run: Run, result: ReconResult, ranBy: { userId: string; name: string }): Promise<string[]> {
  if (isDemoOrg(run.orgKey)) return [];
  const org = await getOrgByKey(run.orgKey);
  const template = await templateForRun(run);
  if (!org || !template) return [];
  const main = result.links[0];
  const keys: string[] = [];
  for (const person of await recipients(run.orgKey, NOTICE_ROLES, "notices")) {
    if (person.userId === ranBy.userId) continue;
    const key = `email:ready:${run.id}:${person.userId}`;
    await queueEmail(key, {
      to: person.email,
      userId: person.userId,
      topic: "notices",
      template: "ready",
      data: {
        name: person.name,
        workspace: org.name,
        template: template.title,
        runId: run.id,
        ranBy: ranBy.name,
        exceptions: result.totals.exceptions,
        value: money(result.totals.value, result.currency),
        matched: main ? { rows: main.matchedLeft, of: main.leftRows } : undefined,
      },
    });
    keys.push(key);
  }
  return keys;
}
