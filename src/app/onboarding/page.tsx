import type { Metadata } from "next";
import { Suspense } from "react";
import { getProfile } from "@/lib/profile/session";
import { OnboardingWizard } from "./onboarding-wizard";

export const metadata: Metadata = { title: "Set up" };

async function Wizard() {
  return <OnboardingWizard initial={await getProfile()} />;
}

export default function OnboardingPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Tell us how you sell</h1>
      <p className="mt-1 text-muted">
        A few one-click questions so Sawwi only shows the reconciliations that apply to you.
      </p>
      <div className="mt-8 rounded-xl border border-border bg-surface p-5 sm:p-8">
        <Suspense fallback={<p className="text-muted">Loading…</p>}>
          <Wizard />
        </Suspense>
      </div>
    </div>
  );
}
