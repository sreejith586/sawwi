"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { requestPlan } from "@/app/actions/billing";
import { buttonClass } from "@/components/ui";
import type { Plan, PlanId } from "@/lib/saas/plans";

export function PlanPicker({
  plans,
  current,
  requested,
  canManage,
  checkoutPlans = [],
  subscribed = false,
}: {
  plans: Plan[];
  current: PlanId;
  requested?: PlanId;
  canManage: boolean;
  /** Plans that can be bought right now with Stripe checkout; others fall back to a request. */
  checkoutPlans?: PlanId[];
  /** With a live subscription, plan changes go through the billing portal instead. */
  subscribed?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <>
      {error && <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = p.id === current;
          const isRequested = p.id === requested;
          return (
            <div key={p.id} className={`flex flex-col rounded-xl border bg-surface p-5 ${isCurrent ? "border-foreground ring-1 ring-foreground" : "border-border"}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{p.name}</p>
                {isCurrent && <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium">Current</span>}
              </div>
              <p className="mt-1 text-sm text-muted">{p.blurb}</p>
              <p className="mt-4 text-xl font-semibold tracking-tight">{p.price}</p>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className="text-success" aria-hidden>
                      ✓
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              {canManage && !isCurrent && checkoutPlans.includes(p.id) ? (
                <Link href={`/checkout/${p.id}`} className={`${buttonClass("primary")} mt-5`}>
                  Subscribe to {p.name}
                </Link>
              ) : canManage && !isCurrent && subscribed && p.id !== "enterprise" ? (
                <p className="mt-5 text-center text-sm text-muted">Switch plans with Manage billing above.</p>
              ) : isRequested ? (
                <p className="mt-5 rounded-lg bg-info-soft px-3 py-2 text-center text-sm font-medium text-info">Requested · we&apos;ll switch you shortly</p>
              ) : (
                <button
                  type="button"
                  disabled={!canManage || isCurrent || pending}
                  onClick={() => start(async () => setError((await requestPlan(p.id)).error))}
                  className={`${buttonClass(isCurrent ? "secondary" : "primary")} mt-5`}
                >
                  {isCurrent ? "Your plan" : p.id === "enterprise" ? "Talk to us" : `Choose ${p.name}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {!canManage && <p className="mt-3 text-sm text-muted">Only workspace owners and admins can change the plan.</p>}
    </>
  );
}
