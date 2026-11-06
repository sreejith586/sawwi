"use client";

import { useActionState, useState } from "react";
import { saveProfile, type SaveProfileState } from "@/app/actions/profile";
import { MultiChips, SingleChips, YesNo } from "@/components/chips";
import {
  CHANNELS,
  COUNTRIES,
  MARKETPLACES,
  PAYMENT_METHODS,
  ROLES,
  WEBSTORE_PLATFORMS,
} from "@/lib/profile/options";
import type { Profile, ProfileErrors } from "@/lib/profile/profile";

type Draft = Omit<Profile, "role"> & { role: Profile["role"] | undefined };

type StepId = "about" | "channels" | "marketplace" | "webstore";

const STEP_FIELDS: Record<StepId, (keyof Profile)[]> = {
  about: ["company", "role", "countries"],
  channels: ["channels"],
  marketplace: ["marketplaces"],
  webstore: ["platforms", "payments"],
};

const EMPTY: Draft = {
  company: "",
  role: undefined,
  countries: [],
  channels: [],
  marketplaces: [],
  sellsB2B: false,
  usesMarketplaceFulfilment: false,
  platforms: [],
  payments: [],
};

function validateStep(step: StepId, d: Draft): ProfileErrors {
  const e: ProfileErrors = {};
  if (step === "about") {
    if (!d.company.trim()) e.company = "Enter your company name.";
    if (!d.role) e.role = "Pick your role.";
    if (d.countries.length === 0) e.countries = "Pick at least one country.";
  }
  if (step === "channels" && d.channels.length === 0) e.channels = "Pick where you sell.";
  if (step === "marketplace" && d.marketplaces.length === 0) e.marketplaces = "Pick at least one marketplace.";
  if (step === "webstore") {
    if (d.platforms.length === 0) e.platforms = "Pick your webstore platform.";
    if (d.payments.length === 0) e.payments = "Pick how customers pay.";
  }
  return e;
}

export function OnboardingWizard({ initial }: { initial?: Profile }) {
  const [draft, setDraft] = useState<Draft>(initial ?? EMPTY);
  const [stepIndex, setStepIndex] = useState(0);
  const [localErrors, setLocalErrors] = useState<ProfileErrors>({});
  const [state, formAction, pending] = useActionState<SaveProfileState, FormData>(saveProfile, { errors: {} });

  const steps: StepId[] = [
    "about",
    "channels",
    ...(draft.channels.includes("marketplace") ? (["marketplace"] as const) : []),
    ...(draft.channels.includes("webstore") ? (["webstore"] as const) : []),
  ];
  const index = Math.min(stepIndex, steps.length - 1);
  const current = steps[index];
  const isLast = current === steps[steps.length - 1] && current !== "channels";
  const errors = { ...state.errors, ...localErrors };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setLocalErrors((e) => ({ ...e, [key]: undefined }));
  };

  const next = () => {
    const e = validateStep(current, draft);
    setLocalErrors(e);
    if (Object.keys(e).length === 0) setStepIndex(index + 1);
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    const invalidStep = steps.find((s) => Object.keys(validateStep(s, draft)).length > 0);
    if (invalidStep) {
      e.preventDefault();
      setLocalErrors(validateStep(invalidStep, draft));
      setStepIndex(steps.indexOf(invalidStep));
    }
  };

  const serverErrorStep = steps.find((s) => STEP_FIELDS[s].some((f) => state.errors[f]));

  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-8">
      <ol className="flex flex-wrap gap-2 text-xs font-medium">
        {steps.map((s, i) => (
          <li
            key={s}
            className={
              "rounded-full px-3 py-1 " +
              (i === index ? "bg-accent text-accent-foreground" : i < index ? "bg-accent-soft text-accent-strong" : "bg-surface-muted text-muted")
            }
          >
            {i + 1}. {STEP_TITLES[s]}
          </li>
        ))}
      </ol>

      {/* All steps stay mounted so every answer is submitted with the form. */}
      <Step active={current === "about"}>
        <Question title="Company name">
          <input
            name="company"
            value={draft.company}
            onChange={(e) => set("company", e.target.value)}
            placeholder="e.g. Desert Rose Trading LLC"
            className="w-full max-w-md rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
          {errors.company && <p className="mt-2 text-sm text-danger">{errors.company}</p>}
        </Question>
        <Question title="What's your role?">
          <SingleChips name="role" options={ROLES} value={draft.role} onChange={(v) => set("role", v)} error={errors.role} />
        </Question>
        <Question title="Which countries do you sell in?" hint="Sets currencies and VAT rates.">
          <MultiChips name="countries" options={COUNTRIES} value={draft.countries} onChange={(v) => set("countries", v)} error={errors.countries} />
        </Question>
      </Step>

      <Step active={current === "channels"}>
        <Question title="Where do you sell?" hint="Pick both if you sell on marketplaces and your own store.">
          <MultiChips name="channels" options={CHANNELS} value={draft.channels} onChange={(v) => set("channels", v)} error={errors.channels} />
        </Question>
      </Step>

      <Step active={current === "marketplace"}>
        <Question title="Which marketplaces?">
          <MultiChips name="marketplaces" options={MARKETPLACES} value={draft.marketplaces} onChange={(v) => set("marketplaces", v)} error={errors.marketplaces} />
        </Question>
        <Question title="Do you sell to business buyers (B2B) on marketplaces?">
          <YesNo name="sellsB2B" value={draft.sellsB2B} onChange={(v) => set("sellsB2B", v)} />
        </Question>
        <Question title="Does the marketplace store and ship your stock (FBA / FBN)?">
          <YesNo name="usesMarketplaceFulfilment" value={draft.usesMarketplaceFulfilment} onChange={(v) => set("usesMarketplaceFulfilment", v)} />
        </Question>
      </Step>

      <Step active={current === "webstore"}>
        <Question title="Which platform runs your webstore?">
          <MultiChips name="platforms" options={WEBSTORE_PLATFORMS} value={draft.platforms} onChange={(v) => set("platforms", v)} error={errors.platforms} />
        </Question>
        <Question title="How do customers pay?">
          <MultiChips name="payments" options={PAYMENT_METHODS} value={draft.payments} onChange={(v) => set("payments", v)} error={errors.payments} />
        </Question>
      </Step>

      {serverErrorStep && serverErrorStep !== current && (
        <p className="text-sm text-danger">Some answers need attention in “{STEP_TITLES[serverErrorStep]}”.</p>
      )}

      <div className="flex items-center gap-3 border-t border-border pt-6">
        {index > 0 && (
          <button
            type="button"
            onClick={() => setStepIndex(index - 1)}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface-muted"
          >
            Back
          </button>
        )}
        {isLast ? (
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-strong disabled:opacity-60"
          >
            {pending ? "Saving…" : "Show my reconciliations"}
          </button>
        ) : (
          <button
            type="button"
            onClick={next}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-strong"
          >
            Continue
          </button>
        )}
      </div>
    </form>
  );
}

const STEP_TITLES: Record<StepId, string> = {
  about: "About you",
  channels: "Where you sell",
  marketplace: "Marketplaces",
  webstore: "Webstore",
};

function Step({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <div className={active ? "space-y-7" : "hidden"}>{children}</div>;
}

function Question({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-3 text-base font-semibold">
        {title}
        {hint && <span className="mt-0.5 block text-sm font-normal text-muted">{hint}</span>}
      </legend>
      {children}
    </fieldset>
  );
}
