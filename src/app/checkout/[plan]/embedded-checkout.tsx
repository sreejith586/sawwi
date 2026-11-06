"use client";

import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useCallback, useState } from "react";
import { createCheckoutSession } from "@/app/actions/checkout";

// Stripe's embedded Checkout page (card, Apple Pay / Google Pay and Link) inside our page.
// Card details go straight from the iframe to Stripe; our server only creates the session.

let stripePromise: Promise<Stripe | null> | undefined;
const getStripe = (key: string) => (stripePromise ??= loadStripe(key));

export function SawwiCheckout({ plan, publishableKey }: { plan: string; publishableKey: string }) {
  const [error, setError] = useState<string>();
  const fetchClientSecret = useCallback(async () => {
    const result = await createCheckoutSession(plan);
    if (!result.clientSecret) {
      setError(result.error ?? "Something went wrong starting checkout.");
      throw new Error(result.error);
    }
    return result.clientSecret;
  }, [plan]);

  if (error) {
    return <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">{error}</p>;
  }
  return (
    // Stripe draws its own light card; the rounded frame keeps it tidy in dark mode too.
    <div className="overflow-hidden rounded-2xl border border-border bg-white">
      <EmbeddedCheckoutProvider stripe={getStripe(publishableKey)} options={{ fetchClientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
