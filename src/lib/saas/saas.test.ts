import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";
import { dailyCap, effectivePlan, entitlement, PLANS, usageRows, type BillingState } from "./plans";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 6);
const ZERO = { runsThisMonth: 0, members: 1, invoicesThisMonth: 0, connectors: 0, aiReadsToday: 0, agentCallsToday: 0 };
const base: BillingState = { plan: "trial", status: "active", trialEndsAt: new Date(NOW + 10 * DAY).toISOString(), ...ZERO };
const free: BillingState = { ...base, plan: "free" };
const ended: BillingState = { ...base, trialEndsAt: new Date(NOW - 1).toISOString() };

describe("entitlement", () => {
  it("allows everything while the paywall is off, even an ended trial", () => {
    expect(entitlement({ ...base, trialEndsAt: new Date(NOW - DAY).toISOString(), runsThisMonth: 999 }, false, "run", NOW)).toEqual({ ok: true, reason: "paywall_off", plan: "free" });
  });

  it("blocks a suspended workspace even with the paywall off", () => {
    expect(entitlement({ ...base, status: "suspended" }, false, "run", NOW)).toMatchObject({ ok: false, reason: "suspended" });
  });

  it("counts trial days left, then moves an ended trial to Free instead of blocking it (D-99)", () => {
    expect(entitlement(base, true, "run", NOW)).toEqual({ ok: true, reason: "trial", daysLeft: 10, plan: "trial" });
    expect(effectivePlan(ended, NOW).id).toBe("free");
    expect(entitlement(ended, true, "run", NOW)).toEqual({ ok: true, reason: "plan", plan: "free" });
    expect(entitlement({ ...ended, runsThisMonth: 10 }, true, "run", NOW)).toMatchObject({ ok: false, reason: "run_limit", plan: "free" });
    // A trial still running has the trial's limits, not Free's.
    expect(entitlement({ ...base, runsThisMonth: 10 }, true, "run", NOW)).toMatchObject({ ok: true, reason: "trial" });
  });

  it("applies the plan's monthly run limit", () => {
    expect(entitlement({ ...base, plan: "starter", runsThisMonth: 59 }, true, "run", NOW)).toMatchObject({ ok: true, reason: "plan" });
    expect(entitlement({ ...base, plan: "starter", runsThisMonth: 60 }, true, "run", NOW)).toMatchObject({ ok: false, reason: "run_limit" });
    expect(entitlement({ ...base, plan: "enterprise", runsThisMonth: 10_000 }, true, "run", NOW)).toMatchObject({ ok: true });
  });

  it("applies the seat limit only to invites", () => {
    expect(entitlement({ ...base, plan: "starter", members: 3 }, true, "invite", NOW)).toMatchObject({ ok: false, reason: "member_limit" });
    expect(entitlement({ ...base, plan: "starter", members: 3 }, true, "run", NOW)).toMatchObject({ ok: true });
  });
});

describe("Free plan (D-99)", () => {
  it("is public, costs nothing and has the agreed limits", () => {
    const plan = PLANS.find((p) => p.id === "free")!;
    expect(plan).toMatchObject({ public: true, runsPerMonth: 10, invoicesPerMonth: 25, members: 2, connectors: 1, schedules: false, aiReadsPerDay: 10, agentCallsPerDay: 25 });
  });

  it("enforces each limit on its own action, with an upgrade hint", () => {
    const cases: [Partial<BillingState>, Parameters<typeof entitlement>[2], string][] = [
      [{ runsThisMonth: 10 }, "run", "run_limit"],
      [{ invoicesThisMonth: 25 }, "invoice", "invoice_limit"],
      [{ members: 2 }, "invite", "member_limit"],
      [{ connectors: 1 }, "connector", "connector_limit"],
      [{}, "schedule", "schedule_limit"],
      [{ aiReadsToday: 10 }, "ai_read", "ai_limit"],
      [{ agentCallsToday: 25 }, "agent_call", "agent_limit"],
    ];
    for (const [usage, action, reason] of cases) {
      const e = entitlement({ ...free, ...usage }, true, action, NOW);
      expect(e).toMatchObject({ ok: false, reason, plan: "free" });
      expect(!e.ok && e.message).toContain("Plan & billing");
    }
    // One below each limit is fine, and a limit only stops its own action.
    expect(entitlement({ ...free, runsThisMonth: 9 }, true, "run", NOW).ok).toBe(true);
    expect(entitlement({ ...free, invoicesThisMonth: 24 }, true, "invoice", NOW).ok).toBe(true);
    expect(entitlement({ ...free, runsThisMonth: 10 }, true, "invoice", NOW).ok).toBe(true);
    expect(entitlement({ ...free, runsThisMonth: 10, invoicesThisMonth: 25 }, true, "work", NOW).ok).toBe(true);
  });

  it("isn't enforced while the paywall is off, like the paid limits", () => {
    expect(entitlement({ ...free, runsThisMonth: 99, invoicesThisMonth: 99 }, false, "invoice", NOW)).toMatchObject({ ok: true, reason: "paywall_off" });
    expect(entitlement(free, false, "schedule", NOW).ok).toBe(true);
  });

  it("leaves paid plans as they were: no invoice, connection, schedule or plan AI limits", () => {
    const growth: BillingState = { ...base, plan: "growth", invoicesThisMonth: 10_000, connectors: 50, aiReadsToday: 10_000, agentCallsToday: 10_000 };
    for (const action of ["invoice", "connector", "schedule", "ai_read", "agent_call"] as const) expect(entitlement(growth, true, action, NOW).ok).toBe(true);
    expect(entitlement({ ...growth, runsThisMonth: 300 }, true, "run", NOW)).toMatchObject({ ok: false, reason: "run_limit" });
  });

  it("takes the tighter of the platform and plan AI caps, the plan's only with the paywall on", () => {
    expect(dailyCap(200, 10, true)).toBe(10);
    expect(dailyCap(200, 10, false)).toBe(200);
    expect(dailyCap(5, 10, true)).toBe(5);
    expect(dailyCap(200, null, true)).toBe(200);
  });

  it("lists usage against every limit for the billing page", () => {
    const rows = usageRows(effectivePlan(ended, NOW), { ...ZERO, invoicesThisMonth: 3 });
    expect(rows.map((r) => r.limit)).toEqual([10, 25, 2, 1, 10, 25]);
    expect(rows.find((r) => r.key === "invoicesThisMonth")?.used).toBe(3);
  });
});

describe("passwords", () => {
  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong horse battery", hash)).toBe(false);
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same password")).not.toBe(await hashPassword("same password"));
  });
});
