"use server";

import { isDemoOrg } from "@/lib/demo/demo";
import { getCurrentSession } from "@/lib/saas/session";
import { setEmailPrefs, type EmailPrefs } from "@/lib/email/store";

export type EmailPrefsState = { saved?: boolean; error?: string; prefs?: EmailPrefs };

/** Each person's own switches (D-45): any role can change them, for themselves only. */
export async function saveEmailPrefs(_prev: EmailPrefsState, formData: FormData): Promise<EmailPrefsState> {
  const session = await getCurrentSession();
  if (!session) return { error: "Log in again to change these." };
  if (isDemoOrg(session.org.key)) return { error: "The demo store doesn't send email." };
  const prefs = { reminders: formData.get("reminders") === "on", notices: formData.get("notices") === "on" };
  await setEmailPrefs(session.user.id, prefs);
  return { saved: true, prefs };
}
