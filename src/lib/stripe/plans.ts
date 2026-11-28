import type { PlanId } from "@/lib/saas/plans";

// Which Stripe Price sells which Sawwi plan. Price IDs come from env so test and live
// mode use different prices without code changes. Enterprise stays "talk to us".

export type PaidPlan = Extract<PlanId, "starter" | "growth">;
export const PAID_PLANS: PaidPlan[] = ["starter", "growth"];

type Env = Record<string, string | undefined>;

const PRICE_ENV: Partial<Record<PlanId, string>> = { starter: "STRIPE_PRICE_STARTER", growth: "STRIPE_PRICE_GROWTH" };

/**
 * The Stripe Price ID for a plan. Only a real Price ID (`price_…`) counts: an amount such as "399"
 * pasted into the variable made every checkout fail at Stripe (D-100). Anything else is treated as
 * not set, so checkout says card payments aren't set up, and the server log names the variable.
 */
export function priceIdFor(plan: PlanId, env: Env = process.env): string | undefined {
  const name = PRICE_ENV[plan];
  const value = name ? env[name]?.trim() : undefined;
  if (!value) return undefined;
  if (!/^price_[A-Za-z0-9]+$/.test(value)) {
    console.error(`${name} must be a Stripe Price ID (price_…), from Stripe → Product catalog → the product → its price. It isn't, so ${plan} checkout is off.`);
    return undefined;
  }
  return value;
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
