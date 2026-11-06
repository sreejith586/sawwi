"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { canManageTeam, getCurrentSession } from "@/lib/saas/session";
import { checkoutBlocker } from "@/lib/stripe/checkout";
import { priceIdFor, type PaidPlan } from "@/lib/stripe/plans";
import { appOrigin, ensureCustomer, getStripe } from "@/lib/stripe/server";

/**
 * Creates an embedded Checkout Session for a plan and returns its client secret.
 * Offers card (which includes Apple Pay / Google Pay) and Link, Stripe's one-click wallet.
 * The price comes from server config, never the client.
 */
export type CheckoutResult = { clientSecret?: string; error?: string };

export async function createCheckoutSession(plan: string): Promise<CheckoutResult> {
  const blocked = await checkoutBlocker(plan);
  if (blocked) return { error: blocked };
  const session = (await getCurrentSession())!;

  try {
    const stripe = getStripe()!;
    const customer = await ensureCustomer(session.org, session.user);
    const origin = appOrigin(await headers());
    const metadata = { orgId: session.org.id, plan, userId: session.user.id };

    const checkout = await stripe.checkout.sessions.create({
      ui_mode: "embedded_page",
      mode: "subscription",
      customer,
      client_reference_id: session.org.id,
      line_items: [{ price: priceIdFor(plan as PaidPlan)!, quantity: 1 }],
      // A filter on the payment methods enabled in the Stripe Dashboard: Link must be on there too.
      allowed_payment_method_types: ["card", "link"],
      billing_address_collection: "auto",
      customer_update: { address: "auto", name: "auto" },
      allow_promotion_codes: true,
      metadata,
      subscription_data: { metadata },
      return_url: `${origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
    });
    return checkout.client_secret ? { clientSecret: checkout.client_secret } : { error: "Stripe didn't return a checkout session. Try again." };
  } catch (error) {
    console.error("Stripe checkout session failed", error);
    return { error: "We couldn't reach the payment provider. Try again in a moment." };
  }
}

/** Stripe's hosted billing portal: change plan, update card, download invoices, cancel. */
export async function openBillingPortal() {
  const session = await getCurrentSession();
  if (!session || !canManageTeam(session.access)) redirect("/settings/billing");
  const stripe = getStripe();
  if (!stripe || !session.org.stripeCustomerId) redirect("/settings/billing");
  const portal = await stripe.billingPortal.sessions.create({
    customer: session.org.stripeCustomerId,
    return_url: `${appOrigin(await headers())}/settings/billing`,
  });
  redirect(portal.url);
}
