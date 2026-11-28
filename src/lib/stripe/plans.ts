import type { PlanId } from "@/lib/saas/plans";

// Which Stripe Price sells which Sawwi plan. Price IDs come from env so test and live
// mode use different prices without code changes. Enterprise stays "talk to us".

export type PaidPlan = Extract<PlanId, "starter" | "growth">;
export const PAID_PLANS: PaidPlan[] = ["starter", "growth"];

type Env = Record<string, string | undefined>;

export function priceIdFor(plan: PlanId, env: Env = process.env): string | undefined {
  if (plan === "starter") return env.STRIPE_PRICE_STARTER || undefined;
  if (plan === "growth") return env.STRIPE_PRICE_GROWTH || undefined;
  return undefined;
}

export function planForPrice(priceId: string | undefined, env: Env = process.env): PaidPlan | undefined {
  if (!priceId) return undefined;
  return PAID_PLANS.find((p) => priceIdFor(p, env) === priceId);
}

/** Subscription statuses that keep the paid plan. past_due keeps access while Stripe retries the card. */
const KEEPS_PLAN = new Set(["active", "trialing", "past_due"]);

/**
 * The plan a workspace should be on given its Stripe subscription. Anything that has
 * stopped paying (canceled, unpaid, incomplete_expired, paused) drops to the Free plan
 * (D-99), so the workspace keeps working within Free's limits instead of being blocked.
 */
export function planFromSubscription(status: string, priceId: string | undefined, env: Env = process.env): PlanId {
  if (!KEEPS_PLAN.has(status)) return "free";
  return planForPrice(priceId, env) ?? "free";
}

export const SUBSCRIPTION_LABELS: Record<string, string> = {
  active: "Active",
  trialing: "Trialing",
  past_due: "Payment failed, retrying",
  unpaid: "Unpaid",
  canceled: "Canceled",
  incomplete: "Awaiting payment",
  incomplete_expired: "Expired",
  paused: "Paused",
};
