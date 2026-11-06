"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { setThemePreference, type ThemePreference } from "@/lib/theme";

// Light / System / Dark segmented switch.
// The highlighted segment is drawn by CSS from <html data-theme-pref> (set by the inline
// head script before paint), so it's right on first paint with no hydration mismatch.
// React only reads the attribute for aria-checked, which can safely fill in after hydration.

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme-pref"] });
  return () => observer.disconnect();
}
const readPref = () => document.documentElement.dataset.themePref as ThemePreference | undefined;
const serverPref = () => undefined;

const icon = "size-[15px]";
const OPTIONS: { value: ThemePreference; label: string; icon: ReactNode }[] = [
  {
    value: "light",
    label: "Light",
    icon: (
      <svg aria-hidden viewBox="0 0 20 20" className={icon} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="10" cy="10" r="3.4" />
        <path d="M10 1.8v1.8M10 16.4v1.8M1.8 10h1.8M16.4 10h1.8M4.2 4.2l1.3 1.3M14.5 14.5l1.3 1.3M4.2 15.8l1.3-1.3M14.5 5.5l1.3-1.3" />
      </svg>
    ),
  },
  {
    value: "system",
    label: "System",
    icon: (
      <svg aria-hidden viewBox="0 0 20 20" className={icon} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="3.5" width="15" height="10" rx="1.6" />
        <path d="M7 17h6M10 13.5V17" />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: (
      <svg aria-hidden viewBox="0 0 20 20" className={icon} fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7Z" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export function ThemeToggle() {
  const pref = useSyncExternalStore(subscribe, readPref, serverPref);

  return (
    <div role="radiogroup" aria-label="Color theme" className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-muted/60 p-0.5">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={pref === undefined ? undefined : pref === o.value}
          aria-label={o.label}
          title={o.value === "system" ? "Match system setting" : `${o.label} mode`}
          data-theme-option={o.value}
          onClick={() => setThemePreference(o.value)}
          className="theme-option grid size-6 place-items-center rounded-md text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}
