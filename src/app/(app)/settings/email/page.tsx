import type { Metadata } from "next";
import { Suspense } from "react";
import { isDemoOrg } from "@/lib/demo/demo";
import { emailEnabled } from "@/lib/email/send";
import { getEmailPrefs } from "@/lib/email/store";
import { getCurrentSession } from "@/lib/saas/session";
import { EmailPrefsForm } from "./email-prefs-form";

export const metadata: Metadata = { title: "Email" };

async function Prefs() {
  const session = await getCurrentSession();
  if (!session) return null;
  const demo = isDemoOrg(session.org.key);
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        What Sawwi emails you at <span className="font-medium text-foreground">{session.user.email}</span>. These are your own settings; teammates choose
        theirs.
      </p>
      {demo && <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">The demo store doesn&apos;t send email.</p>}
      {!demo && !emailEnabled() && (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">
          Email isn&apos;t switched on for this server yet (<code>RESEND_API_KEY</code>, see docs/DEPLOY.md). Your choices are saved and apply once it is.
        </p>
      )}
      <EmailPrefsForm initial={await getEmailPrefs(session.user.id)} disabled={demo} />
    </div>
  );
}

export default function EmailSettingsPage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <Prefs />
    </Suspense>
  );
}
