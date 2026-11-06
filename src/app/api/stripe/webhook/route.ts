import type Stripe from "stripe";
import { getStripe, syncSubscription } from "@/lib/stripe/server";

// Stripe → Sawwi. The source of truth for plan changes made outside the checkout page
// (renewals, failed payments, cancellations, plan switches in the billing portal).
// Trust comes only from the signature; this route has no session.
export async function POST(request: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return Response.json({ error: "Stripe webhooks aren't configured." }, { status: 503 });

  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing signature." }, { status: 400 });

  let event: Stripe.Event;
  try {
    // The raw body is required for signature verification.
    event = stripe.webhooks.constructEvent(await request.text(), signature, secret);
  } catch {
    return Response.json({ error: "Invalid signature." }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object;
      if (s.mode === "subscription" && s.subscription) await syncSubscription(typeof s.subscription === "string" ? s.subscription : s.subscription.id);
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      await syncSubscription(event.data.object.id);
      break;
    case "invoice.payment_failed":
    case "invoice.paid": {
      const sub = event.data.object.parent?.subscription_details?.subscription;
      if (sub) await syncSubscription(typeof sub === "string" ? sub : sub.id);
      break;
    }
  }
  return Response.json({ received: true });
}
