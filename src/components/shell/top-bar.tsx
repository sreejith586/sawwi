"use client";

import Link from "next/link";
import { ChatIcon, MenuIcon } from "@/components/icons";
import { toggleChatPanel } from "@/lib/chat-panel";
import { useChatPanelOpen } from "./chat-panel";
import { setNavOpen } from "./sidebar";
import { LogoLockup } from "@/components/brand/logo";

const iconButton =
  "grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40";

// Content top bar: menu + logo on phones, and the button that opens the right chat panel
// (components/shell/chat-panel.tsx) everywhere.
export function TopBar() {
  const chatOpen = useChatPanelOpen();

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-md sm:px-5">
      <button type="button" onClick={() => setNavOpen(true)} className={`${iconButton} md:hidden`} aria-label="Open menu">
        <MenuIcon />
      </button>
      <Link href="/home" className="flex items-center md:hidden">
        <LogoLockup />
      </Link>
      <button
        type="button"
        onClick={toggleChatPanel}
        aria-expanded={chatOpen}
        aria-controls="chat-panel"
        className={`${iconButton} relative ml-auto ${chatOpen ? "bg-surface-muted text-foreground" : ""}`}
        aria-label={chatOpen ? "Close Ask Sawwi" : "Open Ask Sawwi"}
        title="Ask Sawwi"
      >
        <ChatIcon />
        {/* Shown by CSS while the run's chat is waiting for an answer and the panel is closed. */}
        <span aria-hidden className="app-chat-dot absolute right-1.5 top-1.5 size-2 rounded-full bg-danger ring-2 ring-background" />
      </button>
    </header>
  );
}
