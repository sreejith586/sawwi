"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { CalendarIcon, CloseIcon, HomeIcon, PanelIcon, PlusIcon, RunsIcon, TemplatesIcon } from "@/components/icons";
import { toggleSidebar } from "@/lib/sidebar";
import { LogoLockup } from "@/components/brand/logo";

// Left navigation. Desktop: sticky panel that collapses to an icon rail (button or ⌘/Ctrl+B).
// Phone: off-canvas drawer opened from the top bar. Both states live on <html> as data
// attributes, so the sidebar, the top bar and the CSS agree without shared React state.

export function setNavOpen(open: boolean) {
  if (open) document.documentElement.dataset.navOpen = "";
  else delete document.documentElement.dataset.navOpen;
}

const NAV = [
  { href: "/home", label: "Home", icon: HomeIcon },
  { href: "/runs", label: "Reconciliations", icon: RunsIcon },
  { href: "/templates", label: "Templates", icon: TemplatesIcon },
  { href: "/schedules", label: "Schedules", icon: CalendarIcon },
] as const;

/** Tooltip shown next to an icon while the sidebar is collapsed (the label itself is sr-only then). */
function RailTip({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md collapsed:group-hover/item:block collapsed:group-focus-visible/item:block"
    >
      {children}
    </span>
  );
}

const itemClass =
  "group/item relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 collapsed:justify-center collapsed:px-0";

/** Plain markup, so it can render as the Suspense fallback before the pathname is known. */
export function NavItems({ active }: { active?: string | null }) {
  return (
    <ul className="space-y-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const on = active === href;
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={on ? "page" : undefined}
              className={`${itemClass} ${on ? "bg-brand-soft font-medium text-foreground [&>svg]:text-brand" : "text-muted hover:bg-surface-muted/60 hover:text-foreground"}`}
            >
              <Icon />
              <span className="truncate collapsed:sr-only">{label}</span>
              <RailTip>{label}</RailTip>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** usePathname() is request data, so this sits in <Suspense> with <NavItems /> as the fallback. */
export function ActiveNavItems() {
  const pathname = usePathname();
  const active = NAV.find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`))?.href ?? null;
  return <NavItems active={active} />;
}

export function Sidebar({ nav, footer }: { nav: ReactNode; footer: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {/* Phone drawer backdrop. */}
      <div aria-hidden onClick={() => setNavOpen(false)} className="app-sidebar-backdrop fixed inset-0 z-40 bg-black/40 md:hidden" />

      <aside
        aria-label="Main"
        // Following a link closes the phone drawer.
        onClick={(e) => (e.target as HTMLElement).closest("a") && setNavOpen(false)}
        className="app-sidebar fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-surface md:sticky md:top-0 md:h-dvh md:shrink-0"
      >
        <div className="flex h-14 shrink-0 items-center gap-2 px-3 collapsed:justify-center collapsed:px-0">
          <Link href="/home" className="flex min-w-0 items-center collapsed:hidden">
            <LogoLockup />
          </Link>
          <button
            type="button"
            onClick={toggleSidebar}
            className="ml-auto hidden size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 md:grid collapsed:ml-0"
            aria-label="Collapse or expand sidebar"
            title="Collapse or expand sidebar (⌘B / Ctrl+B)"
          >
            <PanelIcon />
          </button>
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            className="ml-auto grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground md:hidden"
            aria-label="Close menu"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="px-3 collapsed:px-2.5">
          <Link
            href="/templates"
            className="group/item relative flex h-9 items-center justify-center gap-2 rounded-lg bg-brand px-3 text-sm font-medium text-on-brand shadow-sm transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 collapsed:px-0"
          >
            <PlusIcon className="size-4" />
            <span className="collapsed:sr-only">New reconciliation</span>
            <RailTip>New reconciliation</RailTip>
          </Link>
        </div>

        <nav className="mt-5 px-3 collapsed:px-2.5" aria-label="Sections">
          <p className="mb-1.5 px-2.5 text-[11px] font-medium uppercase tracking-wide text-muted collapsed:sr-only">Workspace</p>
          {nav}
        </nav>

        <div className="mt-auto border-t border-border p-2">{footer}</div>
      </aside>
    </>
  );
}
