"use server";

import { refresh } from "next/cache";
import { PLANS, type PlanId } from "@/lib/saas/plans";
import { canManageTeam, getCurrentSession } from "@/lib/saas/session";
import { createUpgradeRequest } from "@/lib/saas/store";

export async function requestPlan(plan: PlanId): Promise<{ error?: string }> {
  const session = await getCurrentSession();
  if (!session || !canManageTeam(session.access)) return { error: "Only workspace owners and admins can change the plan." };
  if (!PLANS.some((p) => p.id === plan && p.public)) return { error: "Unknown plan." };
  // Free needs no request: a trial lands on it when it ends, and a cancelled subscription drops to it (D-99).
  if (plan === "free") return { error: "There's nothing to request: workspaces move to Free when a trial ends or a subscription is cancelled." };
  await createUpgradeRequest(session.org.id, session.user.id, plan);
  refresh();
  return {};
}
