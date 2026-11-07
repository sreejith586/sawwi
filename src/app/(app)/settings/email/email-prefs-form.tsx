"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui";
import { saveEmailPrefs, type EmailPrefsState } from "@/app/actions/email";
import type { EmailPrefs } from "@/lib/email/store";

const TOPICS = [
  { name: "reminders", label: "Schedule reminders", hint: "When a scheduled reconciliation comes due and nobody has started it. Owners, admins and editors." },
  { name: "notices", label: "Ready to review", hint: "When a teammate finishes a reconciliation: the exception count and value, with a link to the report." },
] as const;

export function EmailPrefsForm({ initial, disabled }: { initial: EmailPrefs; disabled?: boolean }) {
  const [state, action, pending] = useActionState<EmailPrefsState, FormData>(saveEmailPrefs, {});
  const prefs = state.prefs ?? initial;
  return (
    <form action={action} className="space-y-4">
      <fieldset disabled={disabled} className="divide-y divide-border rounded-xl border border-border bg-surface">
        <legend className="sr-only">Emails you get</legend>
        {TOPICS.map((t) => (
          <label key={t.name} className="flex cursor-pointer items-start gap-3 p-4">
            <input type="checkbox" name={t.name} defaultChecked={prefs[t.name]} className="mt-1 size-4 accent-current" />
            <span>
              <span className="block text-sm font-medium">{t.label}</span>
              <span className="mt-0.5 block text-sm text-muted">{t.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending || disabled} className={buttonClass()}>
          {pending ? "Saving…" : "Save"}
        </button>
        <p role="status" className="text-sm text-muted">
          {state.error ?? (state.saved ? "Saved." : "")}
        </p>
      </div>
    </form>
  );
}
