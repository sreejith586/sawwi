import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { inviteMember, setMemberActive } from "@/lib/accounts/members";
import { runJobsNow, tick } from "@/lib/jobs/runner";
import { listRecentJobs } from "@/lib/jobs/store";
import type { ReconResult } from "@/lib/recon/match";
import { createRun } from "@/lib/runs/store";
import * as saas from "@/lib/saas/store";
import { createSchedule } from "@/lib/schedules/store";
import { queueReadyNotices } from "./notices";
import { queueDueReminders } from "./reminders";
import { EmailError, sendEmail } from "./send";
import { getEmailPrefs, recipients, setEmailPrefs } from "./store";
import { readyEmail, reminderEmail } from "./templates";

const env = process.env as Record<string, string | undefined>;
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sawwi-email-"));
  env.SAWWI_DATA_DIR = dir;
  delete env.RESEND_API_KEY;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete env.RESEND_API_KEY;
  delete env.EMAIL_FROM;
});

/** A fake Resend: records each request and answers with the given status. */
function fakeResend(status = 200) {
  const calls: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      calls.push({ headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return new Response(JSON.stringify(status === 200 ? { id: `re_${calls.length}` } : { message: "nope" }), { status });
    }),
  );
  return calls;
}

async function workspace(name: string) {
  const org = await saas.createOrg(name, 14);
  const add = async (email: string, who: string, access: saas.MembershipAccess) => {
    const user = await saas.createUser(email, who, "x");
    await saas.addMembership(org.id, user.id, access);
    return user;
  };
  return {
    org,
    owner: await add(`owner@${name}.test`, "Olivia Owner", "owner"),
    editor: await add(`editor@${name}.test`, "Ed Editor", "editor"),
    viewer: await add(`viewer@${name}.test`, "Vera Viewer", "viewer"),
  };
}

describe("sending (D-45)", () => {
  it("logs instead of sending without RESEND_API_KEY", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await sendEmail({ to: "a@b.test", subject: "Hi", text: "Body", html: "<p>Body</p>", idempotencyKey: "k1" })).toEqual({ via: "log" });
    expect(fetch).not.toHaveBeenCalled();
    expect(log.mock.calls[0][0]).toContain("to=a@b.test");
  });

  it("posts to Resend with the sender and an idempotency key", async () => {
    env.RESEND_API_KEY = "re_test_not_a_real_key";
    const calls = fakeResend();
    expect(await sendEmail({ to: "a@b.test", subject: "Hi", text: "Body", html: "<p>Body</p>", idempotencyKey: "email:x:1" })).toEqual({ via: "resend", id: "re_1" });
    expect(calls[0].headers).toMatchObject({ authorization: "Bearer re_test_not_a_real_key", "idempotency-key": "email:x:1" });
    expect(calls[0].body).toMatchObject({ from: "Sawwi <sawwi@sawwiapp.ai>", to: ["a@b.test"], subject: "Hi" });
  });

  it("marks Resend's own failures retryable and our bad requests not", async () => {
    env.RESEND_API_KEY = "re_test_not_a_real_key";
    fakeResend(503);
    await expect(sendEmail({ to: "a@b.test", subject: "s", text: "t", html: "h", idempotencyKey: "k" })).rejects.toMatchObject({ retryable: true });
    fakeResend(422);
    const error = await sendEmail({ to: "a@b.test", subject: "s", text: "t", html: "h", idempotencyKey: "k" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailError);
    expect(error).toMatchObject({ retryable: false, message: "Resend answered 422: nope" });
  });
});

describe("copy and design (D-45)", () => {
  it("renders a designed HTML email with a text copy, and escapes what users typed", () => {
    const r = reminderEmail({ name: "Ed Editor", workspace: "Acme <Trading>", template: "Marketplace settlement vs sales", cadence: "Every Monday", dueOn: "2026-11-09" });
    expect(r.subject).toBe("Due: Marketplace settlement vs sales");
    expect(r.html).toMatch(/^<!doctype html>/);
    expect(r.html).toContain('role="presentation"'); // table layout, for Outlook and Gmail
    expect(r.html).toContain(">Open schedules</a>"); // the button
    expect(r.html).toContain("Monday 9 November");
    expect(r.html).toContain("Acme &lt;Trading&gt;");
    expect(r.html).not.toContain("<Trading>");
    expect(r.text).toContain("Hi Ed,");
    expect(r.text).toContain("Open schedules: https://sawwiapp.ai/schedules");
    expect(r.text).toContain("https://sawwiapp.ai/settings/email");

    const ready = readyEmail({ name: "Vera", workspace: "Acme", template: "Orders vs gateway", runId: "run-1", ranBy: "Ed Editor", exceptions: 5, value: "AED 779.00", matched: { rows: 9, of: 10 } });
    expect(ready.subject).toBe("Ready to review: Orders vs gateway, 5 exceptions");
    expect(ready.text).toContain("Ed Editor ran Orders vs gateway in Acme. 5 exceptions worth AED 779.00.");
    expect(ready.text).toContain("Rows matched: 9 of 10");
    expect(ready.html).toContain("#b42318"); // money at risk in the danger colour
    expect(ready.html).toContain('href="https://sawwiapp.ai/runs/run-1"');
    const clean = readyEmail({ name: "V", workspace: "A", template: "T", runId: "r", ranBy: "E", exceptions: 0, value: "AED 0.00" });
    expect(clean.subject).toBe("Ready to review: T, no exceptions");
    expect(clean.html).toContain("#067647");
  });
});

describe("who gets what (D-45)", () => {
  it("picks roles, respects each person's switches and leaves out deactivated teammates", async () => {
    const w = await workspace("roles");
    const emails = async (roles: string[], topic: "reminders" | "notices") => (await recipients(w.org.key, roles, topic)).map((r) => r.email);
    expect(await emails(["owner", "admin", "editor"], "reminders")).toEqual(["owner@roles.test", "editor@roles.test"]);

    await setEmailPrefs(w.editor.id, { reminders: false, notices: true });
    expect(await getEmailPrefs(w.editor.id)).toEqual({ reminders: false, notices: true });
    expect(await emails(["owner", "admin", "editor"], "reminders")).toEqual(["owner@roles.test"]);
    expect(await emails(["owner", "editor", "viewer"], "notices")).toEqual(["owner@roles.test", "editor@roles.test", "viewer@roles.test"]);

    const { member } = await inviteMember(w.org.key, { name: "Vera Viewer", email: "viewer@roles.test", access: "viewer", team: "" });
    await setMemberActive(w.org.key, member!.id, false);
    expect(await emails(["owner", "editor", "viewer"], "notices")).not.toContain("viewer@roles.test");

    await saas.setOrgStatus(w.org.id, "suspended");
    expect(await emails(["owner"], "notices")).toEqual([]);
  });
});

describe("reminders (D-45)", () => {
  it("mails owners and editors once per due period, and sends through the jobs runner", async () => {
    await getDb().run("DELETE FROM jobs");
    const w = await workspace("remind");
    // Weekly on Mondays from 2 Nov: on Wednesday 11 Nov the 9 Nov period is due, two days late.
    await createSchedule({ orgKey: w.org.key, templateId: "mkt-settlement-vs-sales", cadence: "weekly", anchor: 1, startsOn: "2026-11-02", createdBy: null });
    // Monthly on the 1st: its 1 Nov period is ten days old, past the window, so it isn't mailed.
    await createSchedule({ orgKey: w.org.key, templateId: "mkt-settlement-vs-sales", cadence: "monthly", anchor: 1, startsOn: "2026-10-01", createdBy: null });
    const now = new Date("2026-11-11T09:00:00Z");

    expect(await queueDueReminders(now)).toEqual({ queued: 2 });
    expect(await queueDueReminders(new Date("2026-11-11T10:00:00Z"))).toEqual({ queued: 0 }); // the next hourly sweep

    env.RESEND_API_KEY = "re_test_not_a_real_key";
    const calls = fakeResend();
    await setEmailPrefs(w.editor.id, { reminders: false, notices: true }); // switched off after it was queued
    const ran = (await tick(now)).ran.filter((r) => r.kind === "send_email");
    expect(ran).toHaveLength(2);
    expect(ran.every((r) => r.ok)).toBe(true);
    expect(calls.map((c) => c.body.to)).toEqual([["owner@remind.test"]]);
    expect(calls[0].body.subject).toBe("Due: Settlement vs. sales invoices");
    expect(calls[0].headers["idempotency-key"]).toMatch(/^email:reminder:.+:2026-11-09:/);
    const skipped = (await listRecentJobs()).find((j) => j.kind === "send_email" && j.payload.to === "editor@remind.test");
    expect(skipped?.result).toEqual({ skipped: "reminders off" });
  });
});

describe("ready to review (D-45)", () => {
  const result = { templateId: "orders-vs-gateway", asOf: "2026-10-31", currency: "AED", links: [{ matchedLeft: 9, leftRows: 10 }], checks: [], exceptions: [], totals: { exceptions: 5, value: 779 } } as unknown as ReconResult;

  it("tells the rest of the workspace once per run, and retries Resend's failures", async () => {
    await getDb().run("DELETE FROM jobs");
    const w = await workspace("ready");
    const run = await createRun(w.org.key, "mkt-settlement-vs-sales");

    const keys = await queueReadyNotices(run, result, { userId: w.editor.id, name: w.editor.name });
    expect(keys).toHaveLength(2); // the owner and the viewer, not the editor who ran it
    expect(await queueReadyNotices(run, result, { userId: w.editor.id, name: w.editor.name })).toEqual(keys);
    expect((await listRecentJobs()).filter((j) => j.kind === "send_email")).toHaveLength(2); // a re-run queues nothing new

    env.RESEND_API_KEY = "re_test_not_a_real_key";
    fakeResend(503);
    const now = new Date(Date.now() + 1000);
    expect((await runJobsNow(keys, now)).every((r) => !r.ok)).toBe(true);
    expect((await listRecentJobs()).filter((j) => j.kind === "send_email").every((j) => j.status === "queued" && j.attempts === 1)).toBe(true);

    const calls = fakeResend();
    expect(await runJobsNow(keys, now)).toEqual([]); // waiting for its retry time
    const later = new Date(now.getTime() + 2 * 60_000);
    expect((await runJobsNow(keys, later)).every((r) => r.ok)).toBe(true);
    expect(calls.map((c) => c.body.to).flat().sort()).toEqual(["owner@ready.test", "viewer@ready.test"]);
    expect(calls[0].body.subject).toBe("Ready to review: Settlement vs. sales invoices, 5 exceptions");
    expect(String(calls[0].body.text)).toContain("Ed Editor ran Settlement vs. sales invoices in ready. 5 exceptions worth AED 779.00.");
    expect(String(calls[0].body.html)).toContain(">Open the report</a>");
  });

  it("gives up at once on an address Resend refuses", async () => {
    await getDb().run("DELETE FROM jobs");
    const w = await workspace("refused");
    const run = await createRun(w.org.key, "mkt-settlement-vs-sales");
    const keys = await queueReadyNotices(run, result, { userId: w.owner.id, name: w.owner.name });
    env.RESEND_API_KEY = "re_test_not_a_real_key";
    fakeResend(422);
    await runJobsNow(keys, new Date(Date.now() + 1000));
    expect((await listRecentJobs()).filter((j) => j.kind === "send_email").map((j) => j.status)).toEqual(["failed", "failed"]);
  });
});
