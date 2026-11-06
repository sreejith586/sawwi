"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChatIcon, CloseIcon, MenuIcon } from "@/components/icons";
import { setNavOpen } from "./sidebar";

const iconButton =
  "grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30";

// Content top bar: menu + logo on phones, the chat agent on the right everywhere.
export function TopBar() {
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    if (!chatOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setChatOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatOpen]);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-md sm:px-5">
        <button type="button" onClick={() => setNavOpen(true)} className={`${iconButton} md:hidden`} aria-label="Open menu">
          <MenuIcon />
        </button>
        <Link href="/home" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight md:hidden">
          <span className="grid size-7 place-items-center rounded-lg bg-accent text-[13px] font-bold text-accent-foreground">S</span>
          Sawwina
        </Link>
        <button
          type="button"
          onClick={() => setChatOpen((o) => !o)}
          aria-expanded={chatOpen}
          className={`${iconButton} ml-auto ${chatOpen ? "bg-surface-muted text-foreground" : ""}`}
          aria-label="Ask Sawwina"
          title="Ask Sawwina"
        >
          <ChatIcon />
        </button>
      </header>

      {chatOpen && (
        <aside
          aria-label="Ask Sawwina"
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-border bg-surface shadow-xl"
        >
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
            <ChatIcon className="size-4 text-muted" />
            <h2 className="text-sm font-semibold">Ask Sawwina</h2>
            <button type="button" onClick={() => setChatOpen(false)} className={`${iconButton} ml-auto`} aria-label="Close chat">
              <CloseIcon />
            </button>
          </div>
          <div className="flex flex-1 flex-col justify-end gap-3 overflow-y-auto p-4">
            <div className="rounded-xl bg-surface-muted px-3.5 py-3 text-sm">
              Hi! Soon you&apos;ll be able to ask me about your reconciliations here, like{" "}
              <span className="font-medium">&ldquo;Which Noon orders were never paid out?&rdquo;</span>
              <p className="mt-2 text-muted">
                For now, questions about a specific reconciliation are answered in its own chat on the reconciliation page.
              </p>
            </div>
          </div>
          <div className="border-t border-border p-3">
            <input
              disabled
              placeholder="Coming soon"
              className="h-9 w-full rounded-lg border border-border bg-surface-muted px-3 text-sm placeholder:text-muted disabled:cursor-not-allowed"
            />
          </div>
        </aside>
      )}
    </>
  );
}
