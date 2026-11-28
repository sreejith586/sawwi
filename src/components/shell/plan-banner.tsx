import { ctaAttrs } from "@/lib/analytics/events";
import Link from "next/link";
import { LimitText } from "@/components/billing/limit-text";
import { isDemoOrg, untilNextReset } from "@/lib/demo/demo";
import { entitlement } from "@/lib/saas/plans";
import { getCurrentSession } from "@/lib/saas/session";
import { billingState, getSettings } from "@/lib/saas/store";

// Thin notice above every app page: trial ending soon, a monthly limit reached, or suspended.
// Silent while the paywall is off (except suspension). Display only: enforcement is limits.ts.
export async function PlanBanner() {
  const session = await getCurrentSession();
  if (!session) return null;
  if (isDemoOrg(session.org.key)) return <DemoBanner resetIn={untilNextReset(new Date().getTime())} />;
  const [state, { paywallEnabled }] = await Promise.all([billingState(session.org), getSettings()]);
  const run = entitlement(state, paywallEnabled, "run");
  const e = run.ok ? entitlement(state, paywallEnabled, "invoice") : run;

  if (e.ok && !(e.reason === "trial" && (e.daysLeft ?? 99) <= 5)) return null;
  const blocked = !e.ok;

  return (
    <div className={`border-b px-4 py-2 text-center text-sm sm:px-8 ${blocked ? "border-danger/20 bg-danger-soft text-danger" : "border-warn/20 bg-warn-soft text-warn"}`}>
      {e.ok ? (
        <>
          Your free trial ends in {e.daysLeft} day{e.daysLeft === 1 ? "" : "s"}. Then the workspace moves to the Free plan.{" "}
          <Link href="/settings/billing" className="font-medium underline underline-offset-4" {...ctaAttrs("plan_upgrade", "plan_banner")}>
            Pick a plan
          </Link>
        </>
      ) : (
        <LimitText text={e.message} />
      )}
    </div>
  );
}

/** The live demo store (D-32): shared, invented data, reset daily. */
function DemoBanner({ resetIn }: { resetIn: string }) {
  return (
    <div className="border-b border-accent/20 bg-accent-soft px-4 py-2 text-center text-sm text-accent sm:px-8">
      You&apos;re in the live demo: invented data, shared with other visitors, reset in {resetIn} (00:00 UTC). Start a
      reconciliation and click <strong>Fill with demo data</strong>.{" "}
      <Link href="/signup" className="font-medium underline underline-offset-4" {...ctaAttrs("start_free", "plan_banner")}>
        Create your own workspace
      </Link>
    </div>
  );
}
