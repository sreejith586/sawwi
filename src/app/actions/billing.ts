"use server";

import { refresh } from "next/cache";
import { PLANS, type PlanId } from "@/lib/saas/plans";
import { canManageTeam, getCurrentSession } from "@/lib/saas/session";
import { createUpgradeRequest } from "@/lib/saas/store";

export async function requestPlan(plan: PlanId): Promise<{ error?: string }> {
  const session = await getCurrentSession();
  if (!session || !canManageTeam(session.access)) return { error: "Only workspace owners and admins can change the plan." };
  if (!PLANS.some((p) => p.id === plan && p.public)) return { error: "Unknown plan." };
  await createUpgradeRequest(session.org.id, session.user.id, plan);
  refresh();
  return {};
}
