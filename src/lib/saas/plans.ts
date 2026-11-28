// Plans and entitlements. Pure (no DB), so the client can render plan cards and tests can
// cover the rules. Prices are placeholders until pricing is decided; edit them here.
// The limits are enforced in one place, lib/saas/limits.ts, which calls entitlement() (D-99).

export type PlanId = "trial" | "free" | "starter" | "growth" | "enterprise";

export type Plan = {
  id: PlanId;
  name: string;
  price: string;
  blurb: string;
  /** Reconciliation runs started per calendar month (UTC); null = unlimited. */
  runsPerMonth: number | null;
  /** Purchase invoices captured per calendar month (UTC); null = unlimited. */
  invoicesPerMonth: number | null;
  /** Team members including the owner and pending invites; null = unlimited. */
  members: number | null;
  /** Connections to other systems (ERP, marketplaces, accounting); null = unlimited. */
  connectors: number | null;
  /** Whether reconciliations can be scheduled. */
  schedules: boolean;
  /** Paid AI invoice readings in any 24 hours; null = only the platform cap (SAWWI_AI_INVOICES_PER_DAY). */
  aiReadsPerDay: number | null;
  /** Ask Sawwi model calls in any 24 hours; null = only the platform cap (SAWWI_AGENT_CALLS_PER_DAY). */
  agentCallsPerDay: number | null;
  features: string[];
  /** Shown on pricing and the billing page; the trial is automatic, not picked. */
  public: boolean;
};

const UNLIMITED = { invoicesPerMonth: null, connectors: null, schedules: true, aiReadsPerDay: null, agentCallsPerDay: null } as const;

export const PLANS: Plan[] = [
  {
    id: "trial",
    name: "Free trial",
    price: "Free",
    blurb: "Everything in Growth while you try Sawwi.",
    runsPerMonth: 50,
    members: 5,
    ...UNLIMITED,
    features: ["All templates", "Excel exports", "Up to 5 teammates"],
    public: false,
  },
  {
    id: "free",
    name: "Free",
    price: "AED 0",
    blurb: "For trying Sawwi on a small book. No card needed.",
    runsPerMonth: 10,
    invoicesPerMonth: 25,
    members: 2,
    connectors: 1,
    schedules: false,
    aiReadsPerDay: 10,
    agentCallsPerDay: 25,
    features: ["All templates", "10 reconciliations a month", "25 purchase invoices a month", "2 teammates", "1 connection", "Small daily AI allowance"],
    public: true,
  },
  {
    id: "starter",
    name: "Starter",
    price: "AED 399 / month",
    blurb: "For a seller reconciling one or two channels.",
    runsPerMonth: 60,
    members: 3,
    ...UNLIMITED,
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
    ...UNLIMITED,
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
    ...UNLIMITED,
    features: ["Unlimited reconciliations", "Unlimited teammates", "Custom templates", "Priority support"],
    public: true,
  },
];

export const planById = (id: string): Plan => PLANS.find((p) => p.id === id) ?? PLANS[0];

export type OrgStatus = "active" | "suspended";

/** How much of each limited thing the workspace has used (months are calendar months, days are the last 24 hours). */
export type Usage = {
  runsThisMonth: number;
  members: number;
  invoicesThisMonth: number;
  connectors: number;
  aiReadsToday: number;
  agentCallsToday: number;
};

export type BillingState = { plan: PlanId; status: OrgStatus; trialEndsAt: string } & Usage;

const DAY = 86_400_000;

/**
 * The plan that applies now. A trial that has ended is the Free plan (D-99): the workspace keeps
 * working within Free's limits instead of being blocked. Nothing is written; picking a plan does that.
 */
export function effectivePlan(state: Pick<BillingState, "plan" | "trialEndsAt">, now = Date.now()): Plan {
  if (state.plan === "trial" && new Date(state.trialEndsAt).getTime() <= now) return planById("free");
  return planById(state.plan);
}

/** Something that counts against a limit. "work" is any other new work: only role and suspension apply. */
export type LimitAction = "run" | "invoice" | "invite" | "connector" | "schedule" | "ai_read" | "agent_call" | "work";

export type LimitReason = "run_limit" | "invoice_limit" | "member_limit" | "connector_limit" | "schedule_limit" | "ai_limit" | "agent_limit";

/** Category for the plan_limit_hit analytics event. */
export const LIMIT_CATEGORY: Record<LimitReason, "runs" | "invoices" | "members" | "connectors" | "schedules" | "ai_reads" | "agent_calls"> = {
  run_limit: "runs",
  invoice_limit: "invoices",
  member_limit: "members",
  connector_limit: "connectors",
  schedule_limit: "schedules",
  ai_limit: "ai_reads",
  agent_limit: "agent_calls",
};

export type Entitlement =
  | { ok: true; reason: "paywall_off" | "plan" | "trial"; daysLeft?: number; plan: PlanId }
  | { ok: false; reason: "suspended"; message: string; plan: PlanId }
  | { ok: false; reason: LimitReason; message: string; plan: PlanId };

/** Every limit message ends with this, and the UI turns "Plan & billing" into a link (LimitText). */
export const UPGRADE_HINT = "Upgrade in Plan & billing.";

const n = (x: number) => x.toLocaleString("en-US");

function limitBlock(plan: Plan, action: LimitAction, u: Usage): { reason: LimitReason; message: string } | undefined {
  const on = plan.id === "free" ? " on the Free plan" : " in your plan";
  const hit = (cap: number | null, used: number) => cap !== null && used >= cap;
  switch (action) {
    case "run":
      if (hit(plan.runsPerMonth, u.runsThisMonth)) return { reason: "run_limit", message: `You've used all ${n(plan.runsPerMonth!)} reconciliations${on} this month. ${UPGRADE_HINT}` };
      return;
    case "invoice":
      if (hit(plan.invoicesPerMonth, u.invoicesThisMonth)) return { reason: "invoice_limit", message: `You've captured all ${n(plan.invoicesPerMonth!)} purchase invoices${on} this month. ${UPGRADE_HINT}` };
      return;
    case "invite":
      if (hit(plan.members, u.members)) return { reason: "member_limit", message: `Your plan includes ${n(plan.members!)} teammates, counting pending invites. ${UPGRADE_HINT}` };
      return;
    case "connector":
      if (hit(plan.connectors, u.connectors)) return { reason: "connector_limit", message: `Your plan includes ${n(plan.connectors!)} connection${plan.connectors === 1 ? "" : "s"}. Remove one, or upgrade in Plan & billing.` };
      return;
    case "schedule":
      if (!plan.schedules) return { reason: "schedule_limit", message: `Scheduled reconciliations aren't included${on}. You can still start them by hand. ${UPGRADE_HINT}` };
      return;
    case "ai_read":
      if (hit(plan.aiReadsPerDay, u.aiReadsToday)) return { reason: "ai_limit", message: `You've used the ${n(plan.aiReadsPerDay!)} AI invoice readings${on} for the last 24 hours. Type it in, try again later, or upgrade in Plan & billing.` };
      return;
    case "agent_call":
      if (hit(plan.agentCallsPerDay, u.agentCallsToday)) return { reason: "agent_limit", message: `Ask Sawwi has used the ${n(plan.agentCallsPerDay!)} assistant calls${on} for the last 24 hours. Try again later, or upgrade in Plan & billing.` };
      return;
    case "work":
      return;
  }
}

/**
 * Whether an org may do this new thing now. Reading existing reports is never blocked.
 * With the paywall off (the default) only a suspension blocks; limits are not enforced.
 * Free's limits follow the same switch (D-99); the platform's AI caps apply either way.
 */
export function entitlement(state: BillingState, paywallEnabled: boolean, action: LimitAction = "run", now = Date.now()): Entitlement {
  const plan = effectivePlan(state, now);
  if (state.status === "suspended") return { ok: false, reason: "suspended", message: "This workspace is suspended. Contact support to restore access.", plan: plan.id };
  if (!paywallEnabled) return { ok: true, reason: "paywall_off", plan: plan.id };

  const blocked = limitBlock(plan, action, state);
  if (blocked) return { ok: false, ...blocked, plan: plan.id };
  if (plan.id === "trial") return { ok: true, reason: "trial", daysLeft: Math.ceil((new Date(state.trialEndsAt).getTime() - now) / DAY), plan: plan.id };
  return { ok: true, reason: "plan", plan: plan.id };
}

/** The tighter of the platform cap and the plan's own (the plan's counts only with the paywall on). */
export function dailyCap(platformCap: number, planCap: number | null, paywallEnabled: boolean): number {
  return paywallEnabled && planCap !== null ? Math.min(platformCap, planCap) : platformCap;
}

export type UsageRow = { key: keyof Usage; label: string; used: number; limit: number | null };

/** What the billing page shows: each limited thing, used against the plan's limit (null = no plan limit). */
export function usageRows(plan: Plan, u: Usage): UsageRow[] {
  return [
    { key: "runsThisMonth", label: "Reconciliations this month", used: u.runsThisMonth, limit: plan.runsPerMonth },
    { key: "invoicesThisMonth", label: "Purchase invoices this month", used: u.invoicesThisMonth, limit: plan.invoicesPerMonth },
    { key: "members", label: "Teammates (incl. pending invites)", used: u.members, limit: plan.members },
    { key: "connectors", label: "Connections", used: u.connectors, limit: plan.connectors },
    { key: "aiReadsToday", label: "AI invoice readings, last 24 hours", used: u.aiReadsToday, limit: plan.aiReadsPerDay },
    { key: "agentCallsToday", label: "Ask Sawwi calls, last 24 hours", used: u.agentCallsToday, limit: plan.agentCallsPerDay },
  ];
}
