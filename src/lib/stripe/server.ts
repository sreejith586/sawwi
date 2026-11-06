import Stripe from "stripe";
import * as store from "@/lib/saas/store";
import { planFromSubscription, priceIdFor, type PaidPlan } from "./plans";

// Server-only Stripe access. Secret keys never reach the browser: the client only gets
// the publishable key and a Checkout Session client secret.

let client: Stripe | undefined;

export function getStripe(): Stripe | undefined {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return undefined;
  client ??= new Stripe(key, { appInfo: { name: "Sawwi" } });
  return client;
}

/** Card checkout is offered only when keys and the plan's price are all configured. */
export function checkoutReady(plan?: PaidPlan): boolean {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) return false;
  return plan ? Boolean(priceIdFor(plan)) : Boolean(priceIdFor("starter") || priceIdFor("growth"));
}

/** One Stripe Customer per workspace, created on first checkout. */
export async function ensureCustomer(org: store.Org, user: store.User): Promise<string> {
  if (org.stripeCustomerId) return org.stripeCustomerId;
  const stripe = getStripe()!;
  const customer = await stripe.customers.create({
    email: user.email,
    name: org.name,
    metadata: { orgId: org.id, orgKey: org.key },
  });
  store.setStripeCustomer(org.id, customer.id);
  return customer.id;
}

/** Re-reads a subscription from Stripe and applies it to its workspace. Safe to call repeatedly. */
export async function syncSubscription(subscriptionId: string): Promise<store.Org | undefined> {
  const stripe = getStripe();
  if (!stripe) return undefined;
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const org = (sub.metadata.orgId && store.getOrg(sub.metadata.orgId)) || store.getOrgByStripeCustomer(customerId);
  if (!org) return undefined;

  const item = sub.items.data[0];
  const periodEnd = item?.current_period_end;
  store.applySubscription(org.id, {
    id: sub.id,
    status: sub.status,
    plan: planFromSubscription(sub.status, item?.price.id),
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : undefined,
  });
  if (!org.stripeCustomerId) store.setStripeCustomer(org.id, customerId);
  return store.getOrg(org.id);
}

/** Where Stripe should send people back to. Prefers an explicit app URL over request headers. */
export function appOrigin(headers: Headers): string {
  const configured = process.env.APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost:3000";
  const proto = headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
