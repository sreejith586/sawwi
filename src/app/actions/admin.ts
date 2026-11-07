"use server";

import { refresh } from "next/cache";
import { PLANS, type PlanId } from "@/lib/saas/plans";
import { getCurrentSession } from "@/lib/saas/session";
import * as store from "@/lib/saas/store";

// Superadmin-only platform controls. Every action re-checks the session; superadmin is
// granted only by the SAWWI_SUPERADMIN_EMAILS env var, never from inside the app.

async function requireSuperadmin() {
  const session = await getCurrentSession();
  if (!session?.isSuperadmin) throw new Error("Not allowed.");
}

const isPlan = (p: string): p is PlanId => PLANS.some((x) => x.id === p);

export async function setPaywall(enabled: boolean) {
  await requireSuperadmin();
  await store.setSetting("paywallEnabled", enabled);
  refresh();
}

export async function setSignupsOpen(open: boolean) {
  await requireSuperadmin();
  await store.setSetting("signupsOpen", open);
  refresh();
}

export async function setTrialDays(days: number) {
  await requireSuperadmin();
  if (!Number.isInteger(days) || days < 1 || days > 365) return;
  await store.setSetting("trialDays", days);
  refresh();
}

export async function setOrgPlan(orgId: string, plan: string) {
  await requireSuperadmin();
  if (!isPlan(plan)) return;
  await store.setOrgPlan(orgId, plan);
  const open = await store.openRequestForOrg(orgId);
  if (open && open.plan === plan) await store.setRequestStatus(open.id, "done");
  refresh();
}

export async function extendOrgTrial(orgId: string, days: number) {
  await requireSuperadmin();
  if (!Number.isInteger(days) || days < 1 || days > 365) return;
  await store.extendTrial(orgId, days);
  refresh();
}

export async function setOrgSuspended(orgId: string, suspended: boolean) {
  await requireSuperadmin();
  await store.setOrgStatus(orgId, suspended ? "suspended" : "active");
  refresh();
}

export async function approveRequest(requestId: string) {
  await requireSuperadmin();
  const req = await store.getRequest(requestId);
  if (!req || req.status !== "open") return;
  await store.setOrgPlan(req.orgId, req.plan);
  await store.setRequestStatus(req.id, "done");
  refresh();
}

export async function declineRequest(requestId: string) {
  await requireSuperadmin();
  await store.setRequestStatus(requestId, "declined");
  refresh();
}

/** Re-seals connection secrets under the active connector key (D-40). */
export async function rewrapConnectorSecrets(): Promise<{ rewrapped: number; failed: number }> {
  await requireSuperadmin();
  const { rewrapAll } = await import("@/lib/connectors/keyring");
  const result = await rewrapAll();
  refresh();
  return result;
}
