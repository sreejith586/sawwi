import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { buttonClass } from "@/components/ui";
import { planById } from "@/lib/saas/plans";
import { getCurrentSession } from "@/lib/saas/session";
import { getStripe, syncSubscription } from "@/lib/stripe/server";

export const metadata: Metadata = { title: "Payment" };

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));

// Stripe sends people here after checkout. We read the session from Stripe (never trust the
// URL alone), make sure it belongs to this workspace, and apply the subscription right away
// so the plan is live even before the webhook arrives.
async function Result({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const { session_id } = await searchParams;
  const session = await getCurrentSession();
  const stripe = getStripe();
  if (!session || !stripe || !session_id) redirect("/settings/billing");

  let checkout;
  try {
    checkout = await stripe.checkout.sessions.retrieve(session_id);
  } catch {
    redirect("/settings/billing");
  }
  if (checkout.client_reference_id !== session.org.id) redirect("/settings/billing");

  const plan = checkout.metadata?.plan ?? "";
  if (checkout.status === "open") redirect(`/checkout/${plan}`);
  if (checkout.status !== "complete") {
    return (
      <Panel tone="danger" title="This checkout expired" body="Nothing was charged. Start again from Plan & billing.">
        <Link href="/settings/billing" className={buttonClass("primary")}>
          Back to Plan &amp; billing
        </Link>
      </Panel>
    );
  }

  const subscriptionId = typeof checkout.subscription === "string" ? checkout.subscription : checkout.subscription?.id;
  const org = subscriptionId ? await syncSubscription(subscriptionId) : undefined;

  return (
    <Panel
      tone="success"
      title={`You're on ${planById(org?.plan ?? plan).name}`}
      body={`Thanks! ${session.org.name} is subscribed${org?.currentPeriodEnd ? ` and renews on ${day(org.currentPeriodEnd)}` : ""}. A receipt is on its way to ${checkout.customer_details?.email ?? session.user.email}.`}
    >
      <Link href="/home" className={buttonClass("primary")}>
        Go to Sawwi
      </Link>
      <Link href="/settings/billing" className={buttonClass("secondary")}>
        View billing
      </Link>
    </Panel>
  );
}

function Panel({ tone, title, body, children }: { tone: "success" | "danger"; title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-border bg-surface p-8 text-center">
      <span className={`mx-auto grid size-12 place-items-center rounded-full ${tone === "success" ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>
        <svg aria-hidden viewBox="0 0 20 20" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={tone === "success" ? "m4.5 10.5 3.5 3.5 7.5-8" : "M6 6l8 8M14 6l-8 8"} />
        </svg>
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted">{body}</p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">{children}</div>
    </div>
  );
}

export default function CheckoutReturnPage(props: PageProps<"/checkout/return">) {
  return (
    <Suspense fallback={<p className="text-center text-muted">Confirming your payment…</p>}>
      <Result searchParams={props.searchParams as Promise<{ session_id?: string }>} />
    </Suspense>
  );
}
