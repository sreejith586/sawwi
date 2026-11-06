import Link from "next/link";
import { getProfile } from "@/lib/profile/session";
import { labelOf, ROLES } from "@/lib/profile/options";

export async function ProfileBadge() {
  const profile = await getProfile();
  if (!profile) {
    return (
      <Link href="/onboarding" className="text-sm font-medium text-accent hover:text-accent-strong">
        Get started
      </Link>
    );
  }
  return (
    <Link
      href="/onboarding"
      className="flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm hover:bg-surface-muted"
      title="Edit profile"
    >
      <span className="max-w-24 truncate font-medium sm:max-w-40">{profile.company}</span>
      <span className="hidden text-muted sm:inline">· {labelOf(ROLES, profile.role)}</span>
    </Link>
  );
}
