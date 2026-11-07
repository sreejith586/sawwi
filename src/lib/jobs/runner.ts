import { resetDemoIfDue } from "@/lib/demo/workspace";
import { deleteFiles, listOlderThan } from "@/lib/files/storage";
import { claimJobs, enqueueJob, failJob, finishJob, pruneJobs, type Job } from "./store";

// Background work (D-42). Vercel Cron calls /api/cron/tick every 15 minutes; each tick queues the
// periodic jobs that are due (their keys make a second tick a no-op) and runs whatever is due,
// within a time budget. Handlers must be idempotent: a job can run again after a crash.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const MAX_ATTEMPTS = 3;
const LOCK_MS = 5 * 60_000;

type Handler = (job: Job, now: Date) => Promise<unknown>;

export const HANDLERS: Record<string, Handler> = {
  /** The demo store's daily wipe (D-32), now on time even when nobody visits. */
  demo_reset: async (_, now) => ({ reset: await resetDemoIfDue(now.getTime()) }),
  /** Raw browser uploads that were never parsed (tab closed between the two requests, D-39). */
  cleanup_incoming: async (_, now) => {
    const stale = await listOlderThan("incoming/", new Date(now.getTime() - HOUR));
    await deleteFiles(stale);
    return { deleted: stale.length };
  },
  /** Finished jobs are kept 30 days for a look in Admin, then go. */
  prune_jobs: async (_, now) => ({ pruned: await pruneJobs(new Date(now.getTime() - 30 * DAY)) }),
};

/** The periodic jobs due at `now`, keyed by their period so each runs once per period. */
export function periodicJobs(now: Date): { kind: string; key: string }[] {
  const day = now.toISOString().slice(0, 10);
  const hour = now.toISOString().slice(0, 13);
  return [
    { kind: "demo_reset", key: `demo_reset:${day}` },
    { kind: "cleanup_incoming", key: `cleanup_incoming:${hour}` },
    { kind: "prune_jobs", key: `prune_jobs:${day}` },
  ];
}

/** Retry backoff: 1, 2, 4 minutes… None after the last attempt. */
export const retryAt = (attempts: number, now: Date): Date | null => (attempts >= MAX_ATTEMPTS ? null : new Date(now.getTime() + 2 ** (attempts - 1) * 60_000));

export type TickResult = { queued: number; ran: { id: number; kind: string; ok: boolean; error?: string }[] };

export async function tick(now = new Date(), budgetMs = 45_000, clock: () => number = Date.now): Promise<TickResult> {
  const started = clock();
  let queued = 0;
  // Due as of this tick's clock, so they run in this tick (not a few milliseconds too late).
  for (const p of periodicJobs(now)) if (await enqueueJob(p.kind, p.key, {}, now)) queued++;

  const ran: TickResult["ran"] = [];
  while (clock() - started < budgetMs) {
    const jobs = await claimJobs(5, now, LOCK_MS);
    if (jobs.length === 0) break;
    for (const job of jobs) {
      const handler: Handler | undefined = HANDLERS[job.kind];
      try {
        if (!handler) throw new Error(`No handler for job kind "${job.kind}".`);
        await finishJob(job.id, await handler(job, now));
        ran.push({ id: job.id, kind: job.kind, ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // An unknown kind won't get better by retrying.
        await failJob(job.id, message, job.kind in HANDLERS ? retryAt(job.attempts, now) : null);
        ran.push({ id: job.id, kind: job.kind, ok: false, error: message });
      }
    }
  }
  return { queued, ran };
}
