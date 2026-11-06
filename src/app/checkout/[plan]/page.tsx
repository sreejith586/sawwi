import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { buttonClass } from "@/components/ui";
import { planById, PLANS } from "@/lib/saas/plans";
import { getCurrentSession } from "@/lib/saas/session";
import { checkoutBlocker } from "@/lib/stripe/checkout";
import { priceIdFor, type PaidPlan } from "@/lib/stripe/plans";
import { getStripe } from "@/lib/stripe/server";
import { SawwiCheckout } from "./embedded-checkout";

export const metadata: Metadata = { title: "Checkout" };

/** Live price from Stripe, so the summary always matches what the customer is charged. */
async function livePrice(plan: PaidPlan): Promise<string | undefined> {
  const id = priceIdFor(plan);
  const stripe = getStripe();
  if (!id || !stripe) return undefined;
  try {
    const price = await stripe.prices.retrieve(id);
    if (price.unit_amount === null) return undefined;
    const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: price.currency.toUpperCase() }).format(price.unit_amount / 100);
    const interval = price.recurring ? ` / ${price.recurring.interval_count > 1 ? `${price.recurring.interval_count} ` : ""}${price.recurring.interval}` : "";
    return amount + interval;
  } catch {
    return undefined;
  }
}

async function Checkout({ params }: { params: Promise<{ plan: string }> }) {
  const { plan: planId } = await params;
  if (!PLANS.some((p) => p.id === planId && p.public)) notFound();
  const session = await getCurrentSession();
  if (!session) return null;
  const plan = planById(planId);
  const blocked = await checkoutBlocker(planId);
  const price = blocked ? undefined : await livePrice(planId as PaidPlan);

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <section>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Subscribe</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Sawwi {plan.name}</h1>
        <p className="mt-1.5 text-muted">{plan.blurb}</p>

        <div className="mt-8 rounded-2xl border border-border bg-surface p-5">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-muted">Billed monthly</span>
            <span className="tabular text-xl font-semibold tracking-tight">{price ?? plan.price}</span>
          </div>
          <ul className="mt-5 space-y-2 border-t border-border pt-5 text-sm">
            {plan.features.map((f) => (
              <li key={f} className="flex gap-2">
                <span className="text-success" aria-hidden>
                  ✓
                </span>
                {f}
              </li>
            ))}
          </ul>
          <dl className="mt-5 space-y-1.5 border-t border-border pt-5 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Workspace</dt>
              <dd className="truncate font-medium">{session.org.name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Billing email</dt>
              <dd className="truncate">{session.user.email}</dd>
            </div>
          </dl>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-muted">
          Cancel or switch plans any time from Plan &amp; billing. Pay by card, Apple Pay or Google Pay, or check out in one click with Link if
          you&apos;ve used it before.
        </p>
      </section>

      <section aria-label="Payment">
        {blocked ? (
          <div className="rounded-2xl border border-border bg-surface p-6">
            <p className="font-medium">Checkout isn&apos;t available</p>
            <p className="mt-1.5 text-sm text-muted">{blocked}</p>
            <Link href="/settings/billing" className={`${buttonClass("secondary")} mt-5`}>
              Back to Plan &amp; billing
            </Link>
          </div>
        ) : (
          <SawwiCheckout plan={planId} publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!} />
        )}
      </section>
    </div>
  );
}

export default function CheckoutPage(props: PageProps<"/checkout/[plan]">) {
  return (
    <Suspense fallback={<p className="text-muted">Preparing checkout…</p>}>
      <Checkout params={props.params} />
    </Suspense>
  );
}
