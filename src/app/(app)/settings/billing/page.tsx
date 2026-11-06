import type { Metadata } from "next";
import { Suspense } from "react";
import { entitlement, planById, PLANS } from "@/lib/saas/plans";
import { canManageTeam, getCurrentSession } from "@/lib/saas/session";
import { billingState, getSettings, openRequestForOrg } from "@/lib/saas/store";
import { openBillingPortal } from "@/app/actions/checkout";
import { buttonClass } from "@/components/ui";
import { PAID_PLANS, SUBSCRIPTION_LABELS } from "@/lib/stripe/plans";
import { checkoutReady, getStripe } from "@/lib/stripe/server";
import { PlanPicker } from "./plan-picker";

export const metadata: Metadata = { title: "Plan & billing" };

const BLOCKED: Record<string, string> = {
  trial_ended: "Your free trial has ended. Pick a plan to start new reconciliations. Your existing reports are still here.",
  run_limit: "You've used all the reconciliations in your plan this month. Upgrade to keep going.",
  suspended: "This workspace is suspended. Contact support to restore access.",
  viewer: "You have view-only access. Ask a workspace admin for Editor access to start reconciliations.",
};

const trialOver = (iso: string) => new Date(iso).getTime() <= Date.now();
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

async function Billing({ searchParams }: { searchParams: Promise<{ blocked?: string }> }) {
  const { blocked } = await searchParams;
  const session = await getCurrentSession();
  if (!session) return null;
  const { org } = session;
  const settings = getSettings();
  const state = billingState(org);
  const plan = planById(org.plan);
  const ent = entitlement(state, settings.paywallEnabled);
  const request = openRequestForOrg(org.id);
  const subscribed = Boolean(org.subscriptionStatus && ["active", "trialing", "past_due"].includes(org.subscriptionStatus));
  const checkoutPlans = settings.paywallEnabled && !subscribed ? PAID_PLANS.filter((p) => checkoutReady(p)) : [];
  const canManage = canManageTeam(session.access);

  const status =
    org.status === "suspended"
      ? { label: "Suspended", tone: "bg-danger-soft text-danger" }
      : !settings.paywallEnabled
        ? { label: "Early access", tone: "bg-success-soft text-success" }
        : ent.ok
          ? { label: ent.reason === "trial" ? `Trial · ${ent.daysLeft} day${ent.daysLeft === 1 ? "" : "s"} left` : "Active", tone: "bg-success-soft text-success" }
          : { label: ent.reason === "trial_ended" ? "Trial ended" : "Limit reached", tone: "bg-danger-soft text-danger" };

  return (
    <div className="space-y-10">
      {blocked && BLOCKED[blocked] && (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {BLOCKED[blocked]}
        </p>
      )}

      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs text-muted">Current plan</p>
            <p className="mt-1 text-xl font-semibold tracking-tight">{plan.name}</p>
            <p className="mt-1 text-sm text-muted">
              {!settings.paywallEnabled
                ? "Sawwi is free during early access. Plan limits aren't enforced yet."
                : plan.id === "trial"
                  ? `Trial ${trialOver(org.trialEndsAt) ? "ended" : "ends"} ${day(org.trialEndsAt)}.`
                  : plan.price}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status.tone}`}>{status.label}</span>
            {org.stripeCustomerId && getStripe() && canManage && (
              <form action={openBillingPortal}>
                <button type="submit" className={buttonClass("secondary")}>
                  Manage billing
                </button>
              </form>
            )}
          </div>
        </div>
        {org.subscriptionStatus && (
          <p className={`mt-3 text-sm ${org.subscriptionStatus === "past_due" ? "text-warn" : "text-muted"}`}>
            Card subscription: {SUBSCRIPTION_LABELS[org.subscriptionStatus] ?? org.subscriptionStatus}
            {org.currentPeriodEnd && subscribed ? ` · renews ${day(org.currentPeriodEnd)}` : ""}
            {org.subscriptionStatus === "past_due" ? ". Update your card in Manage billing to avoid losing access." : ""}
          </p>
        )}
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Usage label="Reconciliations this month" used={state.runsThisMonth} limit={plan.runsPerMonth} />
          <Usage label="Teammates (incl. pending invites)" used={state.members} limit={plan.members} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">Plans</h2>
        <p className="mt-0.5 text-sm text-muted">
          {!settings.paywallEnabled
            ? "Paid plans aren't live yet. You can tell us which one you'd want."
            : checkoutPlans.length
              ? "Subscribe by card, Apple Pay, Google Pay or Link. Enterprise is arranged with our team."
              : "Pick a plan and we'll switch your workspace over."}
        </p>
        <PlanPicker
          plans={PLANS.filter((p) => p.public)}
          current={org.plan}
          requested={request?.plan}
          canManage={canManage}
          checkoutPlans={checkoutPlans}
          subscribed={subscribed}
        />
      </section>
    </div>
  );
}

function Usage({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const tone = !limit ? "bg-foreground/30" : pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warn" : "bg-success";
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="tabular font-medium">
          {used.toLocaleString("en-US")}
          {limit !== null && <span className="text-muted"> / {limit.toLocaleString("en-US")}</span>}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${limit ? pct : 100}%` }} />
      </div>
    </div>
  );
}

export default function BillingPage(props: PageProps<"/settings/billing">) {
  return (
    <Suspense fallback={<p className="text-muted">Loading plan…</p>}>
      <Billing searchParams={props.searchParams as Promise<{ blocked?: string }>} />
    </Suspense>
  );
}
