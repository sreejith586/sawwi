"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { completeReset, forgotPassword, logIn, signUp, type AuthState, type ForgotState, type ResetState } from "@/app/actions/auth";
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
  const params = useSearchParams();
  const next = params.get("next") ?? "";
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
      {!state.error && params.get("reset") === "1" && (
        <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
          Your password is changed, and you&apos;re signed out everywhere. Log in with the new one.
        </p>
      )}
      <input type="hidden" name="next" value={next} />
      <Field label="Work email" name="email" type="email" autoComplete="email" defaultValue={state.values?.email} required />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      <p className="-mt-2 text-right text-sm">
        <Link href="/forgot-password" className="text-muted underline decoration-border underline-offset-4 hover:text-foreground hover:decoration-foreground">
          Forgot your password?
        </Link>
      </p>
      <button type="submit" disabled={pending} className={`${buttonClass("primary")} h-10 w-full`}>
        {pending ? "Logging in…" : "Log in"}
      </button>
      <p className="text-center text-sm text-muted">
        New to Sawwi?{" "}
        <Link href="/signup" className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(forgotPassword, {});
  if (state.sent) {
    return (
      <div role="status" className="space-y-4">
        <p className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
          If there&apos;s a Sawwi account for <span className="font-medium">{state.email}</span>, we&apos;ve sent it a link to choose a new password. The link
          works once, for an hour.
        </p>
        <p className="text-sm text-muted">Nothing after a few minutes? Check your spam folder, or make sure it&apos;s the email you log in with.</p>
        <Link href="/login" className={`${buttonClass("secondary")} h-10 w-full`}>
          Back to log in
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
      <Field label="Work email" name="email" type="email" autoComplete="email" defaultValue={state.email} required />
      <button type="submit" disabled={pending} className={`${buttonClass("primary")} h-10 w-full`}>
        {pending ? "Sending…" : "Email me a reset link"}
      </button>
      <p className="text-center text-sm text-muted">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
          Log in
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(completeReset, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}{" "}
          <Link href="/forgot-password" className="font-medium underline underline-offset-4">
            Get a new link
          </Link>
        </p>
      )}
      <input type="hidden" name="token" value={token} />
      <Field label="New password" name="password" type="password" autoComplete="new-password" error={state.fieldError} hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} required />
      <button type="submit" disabled={pending} className={`${buttonClass("primary")} h-10 w-full`}>
        {pending ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}
