"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings", label: "General" },
  { href: "/settings/accounts", label: "Accounts" },
  { href: "/settings/billing", label: "Plan & billing" },
  { href: "/settings/usage", label: "Usage & cost" },
  { href: "/settings/connections", label: "Connections" },
] as const;

export function SettingsTabs({ static: isStatic = false }: { static?: boolean }) {
  return isStatic ? <Tabs active={null} /> : <ActiveTabs />;
}

function ActiveTabs() {
  return <Tabs active={usePathname()} />;
}

function Tabs({ active }: { active: string | null }) {
  return (
    <nav aria-label="Settings" className="mt-6 flex gap-1 border-b border-border">
      {TABS.map((t) => {
        const on = active === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 pb-2.5 text-sm transition-colors ${on ? "border-foreground font-medium text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
