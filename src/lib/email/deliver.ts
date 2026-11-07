import type { Job } from "@/lib/jobs/store";
import { clearJobPayload } from "@/lib/jobs/store";
import type { EmailJobPayload } from "./queue";
import { EmailError, sendEmail } from "./send";
import { getEmailPrefs } from "./store";
import { renderEmail } from "./templates";

/** The `send_email` job (D-45): renders the message now, so copy fixes reach mail still queued. */
export async function deliverEmail(job: Job) {
  const p = job.payload as EmailJobPayload;
  if (!p.to || !p.template) throw new EmailError("This email job has no recipient or template.", false);
  // The user may have switched this off after it was queued.
  if (p.userId && p.topic && !(await getEmailPrefs(p.userId))[p.topic]) return { skipped: `${p.topic} off` };
  const rendered = renderEmail(p.template, p.data ?? {});
  const sent = await sendEmail({ to: p.to, ...rendered, idempotencyKey: job.key });
  if (p.sensitive) await clearJobPayload(job.id);
  return sent;
}
