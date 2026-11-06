import { canManageTeam, getCurrentSession } from "@/lib/saas/session";
import { getSettings } from "@/lib/saas/store";
import { PAID_PLANS, type PaidPlan } from "./plans";
import { checkoutReady } from "./server";

const KEEPS_ACCESS = new Set(["active", "trialing", "past_due"]);

/** Why this user can't buy this plan right now, if anything (shared by the page and the action). */
export async function checkoutBlocker(plan: string): Promise<string | undefined> {
  const session = await getCurrentSession();
  if (!session) return "Log in to subscribe.";
  if (!canManageTeam(session.access)) return "Only workspace owners and admins can change the plan.";
  if (!PAID_PLANS.includes(plan as PaidPlan)) return "This plan can't be bought online. Talk to us instead.";
  if (!getSettings().paywallEnabled) return "Paid plans aren't open yet. Sawwina is free during early access.";
  if (!checkoutReady(plan as PaidPlan)) return "Card payments aren't set up yet.";
  if (session.org.subscriptionStatus && KEEPS_ACCESS.has(session.org.subscriptionStatus)) {
    return "This workspace already has a subscription. Use Manage billing to change plan.";
  }
  return undefined;
}
