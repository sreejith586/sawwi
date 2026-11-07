import { after } from "next/server";
import { enqueueJob } from "@/lib/jobs/store";
import type { EmailTopic } from "./store";
import type { EmailTemplate } from "./templates";

// Every email is a `send_email` job (D-45). The job key is the message's identity
// (e.g. `email:ready:<run>:<user>`), so queueing it twice, or retrying it, never sends it twice.

export type EmailJobPayload = {
  to: string;
  template: EmailTemplate;
  data: Record<string, unknown>;
  /** Checked again when it's sent: switching a topic off stops mail already queued. */
  userId?: string;
  topic?: EmailTopic;
  /** Holds a single-use link: the payload is cleared once it's sent (D-46). */
  sensitive?: boolean;
};

export const EMAIL_JOB = "send_email";

/** Queues one email. Returns whether it's new (false: this message was queued before). */
export function queueEmail(key: string, payload: EmailJobPayload, runAfter = new Date()): Promise<boolean> {
  return enqueueJob(EMAIL_JOB, key, payload, runAfter);
}

/**
 * Sends these queued emails right after the response, instead of on the next cron tick (up to
 * 15 minutes later). Whatever fails here stays queued, and the cron tick retries it.
 * Only call this from a request: a server action or route handler.
 */
export function sendSoon(keys: string[]) {
  if (keys.length === 0) return;
  after(async () => {
    try {
      const { runJobsNow } = await import("@/lib/jobs/runner");
      await runJobsNow(keys);
    } catch (error) {
      console.error("sending queued email failed; the cron tick will retry", error);
    }
  });
}
