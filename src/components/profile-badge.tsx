import Link from "next/link";
import { getProfile } from "@/lib/profile/session";
import { labelOf, ROLES } from "@/lib/profile/options";

export async function ProfileBadge() {
  const profile = await getProfile();
  if (!profile) {
    return (
      <Link href="/onboarding" className="text-sm font-medium underline decoration-border underline-offset-4 hover:decoration-foreground">
        Get started
      </Link>
    );
  }
  const initials = profile.company
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <Link href="/onboarding" className="flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-2.5 text-sm transition-colors hover:bg-surface-muted" title="Edit profile">
      <span className="grid size-7 place-items-center rounded-full border border-border bg-surface-muted text-[11px] font-semibold text-muted">{initials}</span>
      <span className="hidden flex-col leading-tight sm:flex">
        <span className="max-w-44 truncate font-medium">{profile.company}</span>
        <span className="text-xs text-muted">{labelOf(ROLES, profile.role)}</span>
      </span>
    </Link>
  );
}
