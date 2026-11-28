import Link from "next/link";
import { ctaAttrs } from "@/lib/analytics/events";

const LINK_TEXT = "Plan & billing";

/**
 * An error message, with "Plan & billing" turned into a link to the billing page. Every plan
 * limit message names it (UPGRADE_HINT, D-99), so hitting a limit always offers the upgrade.
 * Any other message renders as plain text.
 */
export function LimitText({ text }: { text: string }) {
  const at = text.indexOf(LINK_TEXT);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Link href="/settings/billing" className="font-medium underline underline-offset-4" {...ctaAttrs("plan_upgrade", "limit_message")}>
        {LINK_TEXT}
      </Link>
      {text.slice(at + LINK_TEXT.length)}
    </>
  );
}
