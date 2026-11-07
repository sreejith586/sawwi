import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { HANDLERS, MAX_ATTEMPTS, periodicJobs, retryAt, tick } from "./runner";
import { claimJobs, enqueueJob, failJob, listRecentJobs } from "./store";

const env = process.env as Record<string, string | undefined>;
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sawwi-jobs-"));
  env.SAWWI_DATA_DIR = dir;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const at = (iso: string) => new Date(iso);

describe("background jobs (D-42)", () => {
  it("queues a key once, and claims each due job for one runner only", async () => {
    expect(await enqueueJob("noop", "noop:1")).toBe(true);
    expect(await enqueueJob("noop", "noop:1")).toBe(false); // a second tick or instance: no duplicate
    await enqueueJob("noop", "noop:later", {}, at("2030-01-01T00:00:00Z"));

    const now = new Date(Date.now() + 1000);
    const first = await claimJobs(10, now, 60_000);
    expect(first.map((j) => j.key)).toEqual(["noop:1"]); // the future one isn't due
    expect(first[0]).toMatchObject({ status: "running", attempts: 1 });
    expect(await claimJobs(10, now, 60_000)).toEqual([]); // already taken

    // A runner that crashed: its lock runs out and the job is taken again.
    const again = await claimJobs(10, new Date(now.getTime() + 61_000), 60_000);
    expect(again.map((j) => [j.key, j.attempts])).toEqual([["noop:1", 2]]);
    await getDb().run("DELETE FROM jobs");
  });

  it("backs off 1, 2 minutes and gives up after the last attempt", () => {
    const now = at("2026-11-07T10:00:00Z");
    expect(retryAt(1, now)?.toISOString()).toBe("2026-11-07T10:01:00.000Z");
    expect(retryAt(2, now)?.toISOString()).toBe("2026-11-07T10:02:00.000Z");
    expect(retryAt(MAX_ATTEMPTS, now)).toBeNull();
  });

  it("queues the periodic jobs once per period", () => {
    const keys = (iso: string) => periodicJobs(at(iso)).map((j) => j.key);
    expect(keys("2026-11-07T10:05:00Z")).toEqual(["demo_reset:2026-11-07", "cleanup_incoming:2026-11-07T10", "prune_jobs:2026-11-07"]);
    expect(keys("2026-11-07T10:50:00Z")).toEqual(keys("2026-11-07T10:05:00Z"));
    expect(keys("2026-11-07T11:00:00Z")[1]).toBe("cleanup_incoming:2026-11-07T11");
    for (const j of periodicJobs(at("2026-11-07T10:00:00Z"))) expect(HANDLERS[j.kind]).toBeDefined();
  });

  it("runs a tick: periodic jobs succeed, a second tick in the same hour does nothing, unknown kinds fail for good", async () => {
    // A raw upload abandoned two hours ago, and one still being worked on.
    const incoming = path.join(dir, "files", "incoming", "run-1", "orders");
    mkdirSync(incoming, { recursive: true });
    writeFileSync(path.join(incoming, "0-old.csv"), "a\n");
    writeFileSync(path.join(incoming, "1-new.csv"), "a\n");
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    utimesSync(path.join(incoming, "0-old.csv"), twoHoursAgo, twoHoursAgo);

    await enqueueJob("mystery", "mystery:1");
    const now = new Date();
    const first = await tick(now);
    expect(first.queued).toBe(3);
    expect(first.ran.filter((r) => r.ok).map((r) => r.kind).sort()).toEqual(["cleanup_incoming", "demo_reset", "prune_jobs"]);
    expect(first.ran.find((r) => r.kind === "mystery")).toMatchObject({ ok: false, error: expect.stringMatching(/No handler/) });

    const jobs = await listRecentJobs();
    expect(jobs.find((j) => j.kind === "cleanup_incoming")?.result).toEqual({ deleted: 1 });
    expect(jobs.find((j) => j.kind === "mystery")?.status).toBe("failed");
    expect(jobs.find((j) => j.kind === "demo_reset")?.result).toEqual({ reset: true });

    expect(await tick(now)).toEqual({ queued: 0, ran: [] });
  });

  it("retries a failing job, then marks it failed", async () => {
    await getDb().run("DELETE FROM jobs");
    await enqueueJob("flaky", "flaky:1");
    let now = new Date(Date.now() + 1000);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const [job] = await claimJobs(1, now, 60_000);
      expect(job.attempts).toBe(attempt);
      await failJob(job.id, "boom", retryAt(job.attempts, now));
      now = new Date(now.getTime() + 10 * 60_000);
    }
    expect((await listRecentJobs()).find((j) => j.key === "flaky:1")).toMatchObject({ status: "failed", lastError: "boom", attempts: MAX_ATTEMPTS });
  });

  it("only lets Vercel Cron in", async () => {
    const { GET } = await import("@/app/api/cron/tick/route");
    const req = (auth?: string) => new Request("http://x/api/cron/tick", { headers: auth ? { authorization: auth } : {} });
    delete env.CRON_SECRET;
    expect((await GET(req("Bearer anything"))).status).toBe(503);
    env.CRON_SECRET = "test-cron-secret";
    try {
      expect((await GET(req())).status).toBe(401);
      expect((await GET(req("Bearer wrong"))).status).toBe(401);
      expect((await GET(req("Bearer test-cron-secret"))).status).toBe(200);
    } finally {
      delete env.CRON_SECRET;
    }
  });
});
