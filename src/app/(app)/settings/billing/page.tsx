import type { Metadata } from "next";
import { Suspense } from "react";
import { effectivePlan, entitlement, PLANS, usageRows } from "@/lib/saas/plans";
import { LimitText } from "@/components/billing/limit-text";
import { canManageTeam, getCurrentSession } from "@/lib/saas/session";
import { billingState, getSettings, openRequestForOrg } from "@/lib/saas/store";
import { openBillingPortal } from "@/app/actions/checkout";
import { buttonClass } from "@/components/ui";
import { PAID_PLANS, SUBSCRIPTION_LABELS } from "@/lib/stripe/plans";
import { checkoutReady, getStripe } from "@/lib/stripe/server";
import { PlanPicker } from "./plan-picker";

export const metadata: Metadata = { title: "Plan & billing" };

const BLOCKED: Record<string, string> = {
  run_limit: "You've used all the reconciliations in your plan this month. Upgrade to keep going; your existing reports are all still here.",
  schedule_limit: "Scheduled reconciliations aren't included in your plan. Start them by hand, or upgrade to schedule them.",
  suspended: "This workspace is suspended. Contact support to restore access.",
  viewer: "You have view-only access. Ask a workspace admin for Editor access to start reconciliations.",
};

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

async function Billing({ searchParams }: { searchParams: Promise<{ blocked?: string }> }) {
  const { blocked } = await searchParams;
  const session = await getCurrentSession();
  if (!session) return null;
  const { org } = session;
  const settings = await getSettings();
  const state = await billingState(org);
  // A trial that has ended is the Free plan (D-99).
  const plan = effectivePlan(state);
  const trialEnded = org.plan === "trial" && plan.id === "free";
  const ent = entitlement(state, settings.paywallEnabled);
  const rows = usageRows(plan, state);
  const atLimit = settings.paywallEnabled && rows.some((r) => r.limit !== null && r.used >= r.limit);
  const request = await openRequestForOrg(org.id);
  const subscribed = Boolean(org.subscriptionStatus && ["active", "trialing", "past_due"].includes(org.subscriptionStatus));
  const checkoutPlans = settings.paywallEnabled && !subscribed ? PAID_PLANS.filter((p) => checkoutReady(p)) : [];
  const canManage = canManageTeam(session.access);

  const status =
    org.status === "suspended"
      ? { label: "Suspended", tone: "bg-danger-soft text-danger" }
      : !settings.paywallEnabled
        ? { label: "Early access", tone: "bg-success-soft text-success" }
        : atLimit
          ? { label: "Limit reached", tone: "bg-danger-soft text-danger" }
          : ent.ok && ent.reason === "trial"
            ? { label: `Trial · ${ent.daysLeft} day${ent.daysLeft === 1 ? "" : "s"} left`, tone: "bg-success-soft text-success" }
            : { label: "Active", tone: "bg-success-soft text-success" };

  return (
    <div className="space-y-10">
      {blocked && BLOCKED[blocked] && (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <LimitText text={BLOCKED[blocked]} />
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
                  ? `Trial ends ${day(org.trialEndsAt)}. Then the workspace moves to Free, unless you pick a plan.`
                  : trialEnded
                    ? `Your trial ended ${day(org.trialEndsAt)}. Free has no card and no end date; upgrade any time.`
                    : plan.id === "free"
                      ? "AED 0. No card needed; upgrade any time."
                      : plan.price}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status.tone}`}>{status.label}</span>
            {org.stripeCustomerId && getStripe() && canManage && (
              <form action={openBillingPortal}>
                <button type="submit" className={buttonClass("secondary")} data-track-upgrade="portal" data-track-plan={plan.id}>
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
          {rows.map((r) => (
            <Usage key={r.key} label={r.label} used={r.used} limit={r.limit} />
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">
          {plan.schedules ? "Scheduled reconciliations included." : "Scheduled reconciliations aren't included on Free; start reconciliations by hand."}
          {settings.paywallEnabled ? "" : " Limits apply once paid plans start."}
        </p>
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
          current={plan.id}
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
