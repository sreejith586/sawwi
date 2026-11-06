"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { signOut } from "@/app/actions/auth";
import { ChevronsIcon, PanelIcon, SettingsIcon, UserIcon } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { toggleSidebar } from "@/lib/sidebar";

export type MenuProfile = { company: string; role: string; initials: string; userName: string; userEmail: string; isSuperadmin: boolean };

const rowClass =
  "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30";

// Account + settings menu at the bottom of the sidebar. A disclosure (button + panel), not an
// ARIA menu, so Tab moves through it naturally; Escape or a click outside closes it.
export function SettingsMenu({ profile }: { profile: MenuProfile }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      {open && (
        <div
          id={panelId}
          // Opens upward from the bottom of the sidebar; wider than the rail when collapsed.
          className="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
          onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}
        >
          <div className="px-2.5 pb-2 pt-1.5">
            <p className="truncate text-sm font-medium">{profile.userName}</p>
            <p className="truncate text-xs text-muted">{profile.userEmail}</p>
            <p className="mt-1.5 truncate text-xs text-muted">
              {profile.company} · {profile.role}
            </p>
          </div>
          <div className="my-1 h-px bg-border" />
          <Link href="/settings" className={rowClass}>
            <SettingsIcon className="size-4 text-muted" />
            Settings
          </Link>
          <Link href="/settings/accounts" className={rowClass}>
            <UserIcon className="size-4 text-muted" />
            Accounts
          </Link>
          <Link href="/settings/billing" className={rowClass}>
            <svg aria-hidden viewBox="0 0 20 20" className="size-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2.5" y="4.5" width="15" height="11" rx="1.8" />
              <path d="M2.5 8.5h15M6 12.5h3" />
            </svg>
            Plan &amp; billing
          </Link>
          {profile.isSuperadmin && (
            <Link href="/admin" className={rowClass}>
              <svg aria-hidden viewBox="0 0 20 20" className="size-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 2.5 3.5 5v4.6c0 3.7 2.7 6.6 6.5 7.9 3.8-1.3 6.5-4.2 6.5-7.9V5L10 2.5Z" />
              </svg>
              Admin console
            </Link>
          )}
          <div className="flex h-10 items-center justify-between gap-2 px-2.5 text-sm">
            <span>Theme</span>
            <ThemeToggle />
          </div>
          <button type="button" onClick={toggleSidebar} className={`${rowClass} hidden md:flex`}>
            <PanelIcon className="size-4 text-muted" />
            <span className="collapsed:hidden">Collapse sidebar</span>
            <span className="hidden collapsed:inline">Expand sidebar</span>
            <kbd className="ml-auto rounded border border-border px-1.5 font-sans text-[11px] text-muted">⌘B</kbd>
          </button>
          <div className="my-1 h-px bg-border" />
          <form action={signOut}>
            <button type="submit" className={`${rowClass} text-danger hover:bg-danger-soft`}>
              <svg aria-hidden viewBox="0 0 20 20" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 16.5h3M12.5 13.5 16 10l-3.5-3.5M16 10H8" />
              </svg>
              Sign out
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`Account and settings for ${profile.company}`}
        className="group/item relative flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 collapsed:justify-center"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-surface-muted text-[11px] font-semibold text-muted">
          {profile.initials}
        </span>
        <span className="min-w-0 flex-1 leading-tight collapsed:sr-only">
          <span className="block truncate text-sm font-medium">{profile.userName}</span>
          <span className="block truncate text-xs text-muted">{profile.company}</span>
        </span>
        <ChevronsIcon className="size-4 text-muted collapsed:hidden" />
      </button>
    </div>
  );
}

/** Same footprint as the button, shown while the profile cookie is read. */
export function SettingsMenuSkeleton() {
  return (
    <div className="flex items-center gap-2.5 p-1.5 collapsed:justify-center">
      <span className="size-8 shrink-0 rounded-full bg-surface-muted" />
      <span className="h-3 w-28 rounded bg-surface-muted collapsed:hidden" />
    </div>
  );
}
