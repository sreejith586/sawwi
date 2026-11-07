import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { runJobsNow } from "@/lib/jobs/runner";
import { listRecentJobs } from "@/lib/jobs/store";
import { hashPassword, verifyPassword } from "./password";
import { pruneResets } from "./reset-store";
import { RESET_LIMITS, RESET_TTL_MS, requestPasswordReset, resetLinkValid, resetPassword } from "./reset";
import * as store from "./store";

const env = process.env as Record<string, string | undefined>;
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sawwi-reset-"));
  env.SAWWI_DATA_DIR = dir;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete env.RESEND_API_KEY;
});

/** Sends the queued reset email through a fake Resend and returns the link in it. */
async function linkFrom(emailKey: string, now: Date): Promise<string> {
  env.RESEND_API_KEY = "re_test_not_a_real_key";
  const bodies: { text: string; html: string; subject: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as { text: string; html: string; subject: string });
      return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
    }),
  );
  expect((await runJobsNow([emailKey], now)).every((r) => r.ok)).toBe(true);
  expect(bodies).toHaveLength(1);
  expect(bodies[0].subject).toBe("Reset your Sawwi password");
  expect(bodies[0].html).toContain(">Choose a new password</a>");
  return /https:\/\/sawwiapp\.ai\/reset-password\?token=[\w-]+/.exec(bodies[0].text)![0];
}

describe("password reset (D-46)", () => {
  it("answers the same for unknown emails, and sends a single-use link that expires in an hour", async () => {
    const user = await store.createUser("reset@acme.test", "Rita Reset", await hashPassword("old password 123"));
    const org = await store.createOrg("Acme", 14);
    await store.addMembership(org.id, user.id, "owner");
    await store.createSession(user.id, org.id);
    const now = new Date();

    const unknown = await requestPasswordReset("nobody@acme.test", "10.0.0.1", now);
    expect(unknown).toEqual({ limited: false });
    const known = await requestPasswordReset(" Reset@Acme.test ", "10.0.0.1", now);
    expect(known.limited).toBe(false);
    expect(known.emailKey).toMatch(/^email:reset:/);

    // Only the token's hash is stored.
    const link = await linkFrom(known.emailKey!, new Date(now.getTime() + 1000));
    const token = new URL(link).searchParams.get("token")!;
    expect(token).toHaveLength(43);
    expect(JSON.stringify(await getDb().all("SELECT * FROM password_resets"))).not.toContain(token);
    // …and the sent email's link is cleared from the job.
    expect((await listRecentJobs()).find((j) => j.key === known.emailKey)?.payload).toEqual({});

    expect(await resetLinkValid(token, now)).toBe(true);
    expect(await resetLinkValid(token, new Date(now.getTime() + RESET_TTL_MS + 1))).toBe(false);
    expect(await resetLinkValid("made-up", now)).toBe(false);

    expect(await resetPassword(token, "short", now)).toMatchObject({ ok: false, field: "password" });
    expect(await resetLinkValid(token, now)).toBe(true); // a too-short password doesn't use the link up
    expect(await resetPassword(token, "new password 456", now)).toEqual({ ok: true, userId: user.id });
    expect(await resetPassword(token, "another one 789", now)).toMatchObject({ ok: false, error: expect.stringMatching(/expired or was already used/) });

    const updated = await store.findUserByEmail("reset@acme.test");
    expect(await verifyPassword("new password 456", updated!.passwordHash)).toBe(true);
    expect(await getDb().all("SELECT * FROM sessions WHERE user_id = ?", user.id)).toEqual([]); // signed out everywhere
  });

  it("refuses an expired link, and a second link stops working once one is used", async () => {
    const user = await store.createUser("twice@acme.test", "Tom", await hashPassword("old password 123"));
    const now = new Date();
    const first = await requestPasswordReset("twice@acme.test", "10.0.0.2", now);
    const second = await requestPasswordReset("twice@acme.test", "10.0.0.2", now);
    const t1 = new URL(await linkFrom(first.emailKey!, new Date(now.getTime() + 1000))).searchParams.get("token")!;
    const t2 = new URL(await linkFrom(second.emailKey!, new Date(now.getTime() + 1000))).searchParams.get("token")!;
    expect(await resetPassword(t1, "new password 456", new Date(now.getTime() + RESET_TTL_MS + 1))).toMatchObject({ ok: false });
    expect(await resetPassword(t2, "new password 456", now)).toEqual({ ok: true, userId: user.id });
    expect(await resetLinkValid(t1, now)).toBe(false);
  });

  it("rate-limits by email without saying so, and by address openly", async () => {
    await store.createUser("busy@acme.test", "Bo", await hashPassword("old password 123"));
    const now = new Date();
    const results = [];
    for (let i = 0; i < RESET_LIMITS.perEmail + 2; i++) results.push(await requestPasswordReset("busy@acme.test", `10.1.0.${i}`, now));
    expect(results.filter((r) => r.emailKey)).toHaveLength(RESET_LIMITS.perEmail);
    expect(results.every((r) => !r.limited)).toBe(true);

    for (let i = 0; i < RESET_LIMITS.perIp; i++) await requestPasswordReset(`someone${i}@acme.test`, "10.9.9.9", now);
    expect(await requestPasswordReset("busy2@acme.test", "10.9.9.9", now)).toEqual({ limited: true });
    // An hour later the address may ask again.
    expect((await requestPasswordReset("busy2@acme.test", "10.9.9.9", new Date(now.getTime() + RESET_LIMITS.windowMs + 1))).limited).toBe(false);

    expect(await pruneResets(new Date(now.getTime() + 2 * RESET_LIMITS.windowMs + 1))).toBeGreaterThan(0);
    expect(await getDb().all("SELECT * FROM reset_requests")).toEqual([]);
  });
});
