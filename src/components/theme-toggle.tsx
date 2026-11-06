"use client";

import { THEME_STORAGE_KEY } from "@/lib/theme";

export function ThemeToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode or blocked storage: the switch still works for this page view.
    }
  };

  // The icon is picked by CSS (dark: variant keyed on data-theme), so the server
  // render and the client always agree and nothing flashes.
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Switch between light and dark mode"
      title="Switch light / dark mode"
      className="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
    >
      {/* Moon in light mode (go dark), sun in dark mode (go light). */}
      <svg aria-hidden viewBox="0 0 20 20" className="size-[18px] dark:hidden" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7Z" strokeLinejoin="round" />
      </svg>
      <svg aria-hidden viewBox="0 0 20 20" className="hidden size-[18px] dark:block" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="10" cy="10" r="3.4" />
        <path d="M10 1.8v1.8M10 16.4v1.8M1.8 10h1.8M16.4 10h1.8M4.2 4.2l1.3 1.3M14.5 14.5l1.3 1.3M4.2 15.8l1.3-1.3M14.5 5.5l1.3-1.3" />
      </svg>
    </button>
  );
}
