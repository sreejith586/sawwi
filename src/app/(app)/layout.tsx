import { Suspense } from "react";
import { ChatPanel } from "@/components/shell/chat-panel";
import { ActiveNavItems, NavItems, Sidebar } from "@/components/shell/sidebar";
import { SettingsMenu, SettingsMenuSkeleton } from "@/components/shell/settings-menu";
import { PlanBanner } from "@/components/shell/plan-banner";
import { TopBar } from "@/components/shell/top-bar";
import { labelOf, ROLES } from "@/lib/profile/options";
import { getCurrentSession } from "@/lib/saas/session";

// Signed-in app: left sidebar, top bar and the right chat panel around every page except onboarding.

async function AccountMenu() {
  const session = await getCurrentSession();
  // src/proxy.ts sends signed-out visitors to /login, so this is only a fallback.
  if (!session) return null;
  const { user, org } = session;
  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <SettingsMenu
      profile={{
        company: org.name,
        role: org.profile ? labelOf(ROLES, org.profile.role) : "",
        initials,
        userName: user.name,
        userEmail: user.email,
        isSuperadmin: session.isSuperadmin,
      }}
    />
  );
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
        <Suspense fallback={null}>
          <PlanBanner />
        </Suspense>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8 sm:py-10">{children}</main>
      </div>
      <ChatPanel />
    </div>
  );
}
