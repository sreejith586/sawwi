import Link from "next/link";
import { isDemoOrg, untilNextReset } from "@/lib/demo/demo";
import { getCurrentSession, orgEntitlement } from "@/lib/saas/session";

// Thin notice above every app page: trial ending soon, trial over, limit reached or suspended.
// Silent while the paywall is off (except suspension).
export async function PlanBanner() {
  const session = await getCurrentSession();
  if (!session) return null;
  if (isDemoOrg(session.org.key)) return <DemoBanner resetIn={untilNextReset(new Date().getTime())} />;
  const e = orgEntitlement(session.org);

  if (e.ok && !(e.reason === "trial" && (e.daysLeft ?? 99) <= 5)) return null;
  const blocked = !e.ok;
  const text = e.ok ? `Your free trial ends in ${e.daysLeft} day${e.daysLeft === 1 ? "" : "s"}.` : e.message;

  return (
    <div className={`border-b px-4 py-2 text-center text-sm sm:px-8 ${blocked ? "border-danger/20 bg-danger-soft text-danger" : "border-warn/20 bg-warn-soft text-warn"}`}>
      {text}{" "}
      {e.ok || e.reason !== "suspended" ? (
        <Link href="/settings/billing" className="font-medium underline underline-offset-4">
          {blocked ? "See plans" : "Pick a plan"}
        </Link>
      ) : null}
    </div>
  );
}

/** The live demo store (D-32): shared, invented data, reset daily. */
function DemoBanner({ resetIn }: { resetIn: string }) {
  return (
    <div className="border-b border-accent/20 bg-accent-soft px-4 py-2 text-center text-sm text-accent sm:px-8">
      You&apos;re in the live demo: invented data, shared with other visitors, reset in {resetIn} (00:00 UTC). Start a
      reconciliation and click <strong>Fill with demo data</strong>.{" "}
      <Link href="/signup" className="font-medium underline underline-offset-4">
        Create your own workspace
      </Link>
    </div>
  );
}
