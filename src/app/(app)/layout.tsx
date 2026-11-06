import { Suspense } from "react";
import { ActiveNavItems, NavItems, Sidebar } from "@/components/shell/sidebar";
import { SettingsMenu, SettingsMenuSkeleton } from "@/components/shell/settings-menu";
import { TopBar } from "@/components/shell/top-bar";
import { labelOf, ROLES } from "@/lib/profile/options";
import { getProfile } from "@/lib/profile/session";

// Signed-in app: left sidebar + top bar around every page except onboarding.

async function AccountMenu() {
  const profile = await getProfile();
  // src/proxy.ts keeps visitors without a profile on onboarding, so this is only a fallback.
  if (!profile) return null;
  const initials = profile.company
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return <SettingsMenu profile={{ company: profile.company, role: labelOf(ROLES, profile.role), initials }} />;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar
        nav={
          <Suspense fallback={<NavItems />}>
            <ActiveNavItems />
          </Suspense>
        }
        footer={
          <Suspense fallback={<SettingsMenuSkeleton />}>
            <AccountMenu />
          </Suspense>
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8 sm:py-10">{children}</main>
      </div>
    </div>
  );
}
