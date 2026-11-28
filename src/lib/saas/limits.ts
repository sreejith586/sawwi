import { flashEvent } from "@/lib/analytics/flash-server";
import { dailyCap, effectivePlan, entitlement, LIMIT_CATEGORY, type Entitlement, type LimitAction, type LimitReason, type PlanId } from "./plans";
import * as store from "./store";

// The one place plan limits are enforced on the server (D-99). The rules are entitlement() in
// plans.ts (pure); this module looks up the workspace's usage and the paywall switch, and reports
// a hit to analytics. runBlocker() (session.ts) uses it for signed-in actions; the AI invoice
// reader and the Ask Sawwi agent use planBlock() directly, since they run without a request.

export type PlanBlock = { reason: string; message: string };

export async function orgEntitlementFor(org: store.Org, action: LimitAction = "run"): Promise<Entitlement> {
  return entitlement(await store.billingState(org), (await store.getSettings()).paywallEnabled, action);
}

/** Why this workspace can't do this now, or undefined. A plan limit hit is counted in analytics. */
export async function blockFor(org: store.Org, action: LimitAction): Promise<PlanBlock | undefined> {
  const e = await orgEntitlementFor(org, action);
  if (e.ok) return undefined;
  if (e.reason !== "suspended") await noteLimitHit(e.reason, e.plan);
  return { reason: e.reason, message: e.message };
}

/** Same, by workspace key. An unknown key (tests, scripts) has no plan, so nothing blocks. */
export async function planBlock(orgKey: string, action: LimitAction): Promise<PlanBlock | undefined> {
  const org = await store.getOrgByKey(orgKey);
  return org ? blockFor(org, action) : undefined;
}

/** plan_limit_hit, with categories only. Outside a request (no cookies to set) it is skipped. */
async function noteLimitHit(reason: LimitReason, plan: PlanId) {
  try {
    await flashEvent("plan_limit_hit", { limit: LIMIT_CATEGORY[reason], plan });
  } catch {
    // Rendering or a background job: no response to carry the event.
  }
}

/** The daily cap that applies to this workspace: the platform's, or the plan's when tighter (paywall on). */
export async function dailyCapFor(orgKey: string, kind: "aiReadsPerDay" | "agentCallsPerDay", platformCap: number): Promise<number> {
  const org = await store.getOrgByKey(orgKey);
  if (!org) return platformCap;
  return dailyCap(platformCap, effectivePlan(org)[kind], (await store.getSettings()).paywallEnabled);
}
