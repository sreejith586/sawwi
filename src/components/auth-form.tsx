"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { logIn, signUp, type AuthState } from "@/app/actions/auth";
import { buttonClass } from "@/components/ui";
import { MIN_PASSWORD_LENGTH } from "@/lib/saas/password-rules";

const input =
  "mt-1.5 h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none transition-colors placeholder:text-muted focus:border-foreground/40 aria-[invalid=true]:border-danger";

function Field({ label, name, error, hint, ...props }: { label: string; name: string; error?: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = `f-${name}`;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input id={id} name={name} aria-invalid={Boolean(error)} aria-describedby={error || hint ? `${id}-msg` : undefined} className={input} {...props} />
      {(error || hint) && (
        <p id={`${id}-msg`} className={`mt-1.5 text-xs ${error ? "text-danger" : "text-muted"}`}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function SignUpForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(signUp, {});
  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
      <Field label="Your name" name="name" autoComplete="name" defaultValue={v.name} error={e.name} required />
      <Field label="Work email" name="email" type="email" autoComplete="email" defaultValue={v.email} error={e.email} required />
      <Field
        label="Company"
        name="company"
        autoComplete="organization"
        defaultValue={v.company}
        error={e.company}
        hint="Invited by your team? You'll join their workspace instead."
      />
      <Field label="Password" name="password" type="password" autoComplete="new-password" error={e.password} hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} required />
      <button type="submit" disabled={pending} className={`${buttonClass("primary")} h-10 w-full`}>
        {pending ? "Creating your workspace…" : "Create account"}
      </button>
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
          Log in
        </Link>
      </p>
    </form>
  );
}

export function LogInForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(logIn, {});
  const next = useSearchParams().get("next") ?? "";
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
      <input type="hidden" name="next" value={next} />
      <Field label="Work email" name="email" type="email" autoComplete="email" defaultValue={state.values?.email} required />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      <button type="submit" disabled={pending} className={`${buttonClass("primary")} h-10 w-full`}>
        {pending ? "Logging in…" : "Log in"}
      </button>
      <p className="text-center text-sm text-muted">
        New to Sawwina?{" "}
        <Link href="/signup" className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
          Create an account
        </Link>
      </p>
    </form>
  );
}
