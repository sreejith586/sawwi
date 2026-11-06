// Plans and entitlements. Pure (no DB), so the client can render plan cards and tests can
// cover the rules. Prices are placeholders until pricing is decided; edit them here.

export type PlanId = "trial" | "starter" | "growth" | "enterprise";

export type Plan = {
  id: PlanId;
  name: string;
  price: string;
  blurb: string;
  /** Reconciliation runs started per calendar month; null = unlimited. */
  runsPerMonth: number | null;
  /** Team members including the owner; null = unlimited. */
  members: number | null;
  features: string[];
  /** Shown on pricing; the trial is automatic, not picked. */
  public: boolean;
};

export const PLANS: Plan[] = [
  {
    id: "trial",
    name: "Free trial",
    price: "Free",
    blurb: "Everything in Growth while you try Sawwina.",
    runsPerMonth: 50,
    members: 5,
    features: ["All templates", "Excel exports", "Up to 5 teammates"],
    public: false,
  },
  {
    id: "starter",
    name: "Starter",
    price: "AED 399 / month",
    blurb: "For a seller reconciling one or two channels.",
    runsPerMonth: 60,
    members: 3,
    features: ["All templates", "60 reconciliations a month", "3 teammates", "Excel exports"],
    public: true,
  },
  {
    id: "growth",
    name: "Growth",
    price: "AED 999 / month",
    blurb: "For finance teams across marketplaces, webstore and B2B.",
    runsPerMonth: 300,
    members: 15,
    features: ["Everything in Starter", "300 reconciliations a month", "15 teammates", "Remembered mappings across the team"],
    public: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Talk to us",
    blurb: "For groups with many entities and custom reconciliations.",
    runsPerMonth: null,
    members: null,
    features: ["Unlimited reconciliations", "Unlimited teammates", "Custom templates", "Priority support"],
    public: true,
  },
];

export const planById = (id: string): Plan => PLANS.find((p) => p.id === id) ?? PLANS[0];

export type OrgStatus = "active" | "suspended";

export type BillingState = {
  plan: PlanId;
  status: OrgStatus;
  trialEndsAt: string;
  runsThisMonth: number;
  members: number;
};

export type Entitlement =
  | { ok: true; reason: "paywall_off" | "plan" | "trial"; daysLeft?: number }
  | { ok: false; reason: "suspended" | "trial_ended" | "run_limit" | "member_limit"; message: string };

const DAY = 86_400_000;

/**
 * Whether an org may start new work. Reading existing reports is never blocked.
 * With the paywall off (the default) only a suspension blocks; limits are not enforced.
 */
export function entitlement(state: BillingState, paywallEnabled: boolean, action: "run" | "invite" = "run", now = Date.now()): Entitlement {
  if (state.status === "suspended") return { ok: false, reason: "suspended", message: "This workspace is suspended. Contact support to restore access." };
  if (!paywallEnabled) return { ok: true, reason: "paywall_off" };

  const plan = planById(state.plan);
  let daysLeft: number | undefined;
  if (plan.id === "trial") {
    const left = new Date(state.trialEndsAt).getTime() - now;
    if (left <= 0) return { ok: false, reason: "trial_ended", message: "Your free trial has ended. Pick a plan to keep reconciling." };
    daysLeft = Math.ceil(left / DAY);
  }
  if (action === "run" && plan.runsPerMonth !== null && state.runsThisMonth >= plan.runsPerMonth) {
    return { ok: false, reason: "run_limit", message: `You've used all ${plan.runsPerMonth} reconciliations in your plan this month.` };
  }
  if (action === "invite" && plan.members !== null && state.members >= plan.members) {
    return { ok: false, reason: "member_limit", message: `Your plan includes ${plan.members} teammates. Upgrade to add more.` };
  }
  return { ok: true, reason: plan.id === "trial" ? "trial" : "plan", daysLeft };
}
