import { getDb, type Row } from "@/lib/db";

// All SQL for background jobs (D-42). A job's key is unique, so queueing the same piece of work
// twice (two cron ticks, two instances) is a no-op. Claiming takes due jobs with
// FOR UPDATE SKIP LOCKED, so two runners never take the same job.

export type JobStatus = "queued" | "running" | "done" | "failed";
export type Job = {
  id: number;
  kind: string;
  key: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  runAfter: string;
  attempts: number;
  lastError: string | null;
  result: unknown;
  createdAt: string;
  finishedAt: string | null;
};

const toJob = (r: Row): Job => ({
  id: Number(r.id),
  kind: String(r.kind),
  key: String(r.key),
  payload: JSON.parse(String(r.payload_json)) as Record<string, unknown>,
  status: r.status as JobStatus,
  runAfter: String(r.run_after),
  attempts: Number(r.attempts),
  lastError: r.last_error === null ? null : String(r.last_error),
  result: r.result_json === null ? null : (JSON.parse(String(r.result_json)) as unknown),
  createdAt: String(r.created_at),
  finishedAt: r.finished_at === null ? null : String(r.finished_at),
});

/** Queues a job unless one with this key exists. Returns whether it was new. */
export async function enqueueJob(kind: string, key: string, payload: Record<string, unknown> = {}, runAfter = new Date()): Promise<boolean> {
  const now = new Date().toISOString();
  const r = await getDb().run(
    "INSERT INTO jobs (kind, key, payload_json, status, run_after, created_at) VALUES (?, ?, ?, 'queued', ?, ?) ON CONFLICT (key) DO NOTHING",
    kind,
    key,
    JSON.stringify(payload),
    runAfter.toISOString(),
    now,
  );
  return r.changes === 1;
}

/** Takes up to `limit` due jobs: queued ones whose time has come, and running ones whose lock ran out (a crashed runner). */
export async function claimJobs(limit: number, now: Date, lockMs: number): Promise<Job[]> {
  const at = now.toISOString();
  const rows = await getDb().all(
    `UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_until = ?
     WHERE id IN (
       SELECT id FROM jobs
       WHERE (status = 'queued' AND run_after <= ?) OR (status = 'running' AND locked_until < ?)
       ORDER BY run_after, id LIMIT ? FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    new Date(now.getTime() + lockMs).toISOString(),
    at,
    at,
    limit,
  );
  return rows.map(toJob);
}

export async function finishJob(id: number, result: unknown) {
  await getDb().run("UPDATE jobs SET status = 'done', locked_until = NULL, last_error = NULL, result_json = ?, finished_at = ? WHERE id = ?", JSON.stringify(result ?? null), new Date().toISOString(), id);
}

/** A failed attempt: retried after `retryAt`, or marked failed for good when there's none. */
export async function failJob(id: number, error: string, retryAt: Date | null) {
  if (retryAt) {
    await getDb().run("UPDATE jobs SET status = 'queued', locked_until = NULL, last_error = ?, run_after = ? WHERE id = ?", error, retryAt.toISOString(), id);
  } else {
    await getDb().run("UPDATE jobs SET status = 'failed', locked_until = NULL, last_error = ?, finished_at = ? WHERE id = ?", error, new Date().toISOString(), id);
  }
}

export async function listRecentJobs(limit = 20): Promise<Job[]> {
  return (await getDb().all("SELECT * FROM jobs ORDER BY created_at DESC, id DESC LIMIT ?", limit)).map(toJob);
}

/** Finished jobs older than the cutoff go; failed ones are kept for a look. */
export async function pruneJobs(before: Date): Promise<number> {
  return (await getDb().run("DELETE FROM jobs WHERE status = 'done' AND finished_at < ?", before.toISOString())).changes;
}
