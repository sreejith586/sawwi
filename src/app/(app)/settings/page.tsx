import { buttonClass } from "@/components/ui";
import { CookieSettingsButton } from "@/components/analytics/analytics";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { getProfile } from "@/lib/profile/session";
import { OnboardingWizard } from "@/app/onboarding/onboarding-wizard";

export const metadata: Metadata = { title: "Settings" };

async function ProfileForm() {
  return <OnboardingWizard initial={await getProfile()} submitLabel="Save profile" />;
}

export default function SettingsPage() {
  return (
    <div className="space-y-10">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-5">
        <div>
          <h2 className="text-sm font-semibold">Appearance</h2>
          <p className="mt-0.5 text-sm text-muted">Light, dark, or match your computer&apos;s setting.</p>
        </div>
        <ThemeToggle />
      </section>

      <CookieSettingsSection />

      <section id="profile" className="scroll-mt-20">
        <h2 className="text-sm font-semibold">Business profile</h2>
        <p className="mt-0.5 text-sm text-muted">Sawwi uses this to pick the reconciliations that apply to you.</p>
        <div className="mt-4 rounded-xl border border-border bg-surface p-5 sm:p-8">
          <Suspense fallback={<p className="text-muted">Loading…</p>}>
            <ProfileForm />
          </Suspense>
        </div>
      </section>
    </div>
  );
}

/** Analytics cookies (D-97): shown only when GA4 or Clarity is configured. */
function CookieSettingsSection() {
  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-5 [&:not(:has(button))]:hidden">
      <div>
        <h2 className="text-sm font-semibold">Analytics cookies</h2>
        <p className="mt-0.5 text-sm text-muted">Change whether Google Analytics and Microsoft Clarity may set cookies in this browser.</p>
      </div>
      <CookieSettingsButton className={buttonClass("secondary")} />
    </section>
  );
}
