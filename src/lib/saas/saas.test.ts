import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";
import { entitlement, type BillingState } from "./plans";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 6);
const base: BillingState = { plan: "trial", status: "active", trialEndsAt: new Date(NOW + 10 * DAY).toISOString(), runsThisMonth: 0, members: 1 };

describe("entitlement", () => {
  it("allows everything while the paywall is off, even an ended trial", () => {
    expect(entitlement({ ...base, trialEndsAt: new Date(NOW - DAY).toISOString(), runsThisMonth: 999 }, false, "run", NOW)).toEqual({ ok: true, reason: "paywall_off" });
  });

  it("blocks a suspended workspace even with the paywall off", () => {
    expect(entitlement({ ...base, status: "suspended" }, false, "run", NOW)).toMatchObject({ ok: false, reason: "suspended" });
  });

  it("counts trial days left and blocks once the trial ends", () => {
    expect(entitlement(base, true, "run", NOW)).toEqual({ ok: true, reason: "trial", daysLeft: 10 });
    expect(entitlement({ ...base, trialEndsAt: new Date(NOW - 1).toISOString() }, true, "run", NOW)).toMatchObject({ ok: false, reason: "trial_ended" });
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
