"use client";

import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ChatIcon, CloseIcon } from "@/components/icons";
import { CHAT_MAX_WIDTH, CHAT_MIN_WIDTH, currentChatWidth, isChatOpen, resetChatWidth, setChatOpen, setChatWidth, subscribeChatPanel } from "@/lib/chat-panel";

// Right-hand "Ask Sawwi" panel, the mirror of the left sidebar. Desktop (≥ 64rem): docked, full
// height, pushes the page over, and the user drags its left border to resize it (or focuses the
// border and uses the arrow keys). Narrower screens: an overlay drawer. Open/closed and the width
// live on <html> (lib/chat-panel.ts). Pages put their own chat in it through a portal into
// #chat-panel-slot (see useChatPanelSlot); when a page has none, the general panel shows.

export const CHAT_SLOT_ID = "chat-panel-slot";

// The panel's slots, announced when it mounts: "body" for a page's chat, "header" for that
// chat's status line under the title. Pages subscribe, so whichever renders first, the page's
// content lands in the panel as soon as both are there.
type SlotName = "body" | "header";
const slots: Record<SlotName, HTMLElement | null> = { body: null, header: null };
const slotListeners = new Set<() => void>();
function setSlot(name: SlotName, el: HTMLElement | null) {
  if (slots[name] === el) return;
  slots[name] = el;
  for (const l of slotListeners) l();
}
const registerBody = (el: HTMLElement | null) => setSlot("body", el);
const registerHeader = (el: HTMLElement | null) => setSlot("header", el);
const subscribeSlot = (cb: () => void) => {
  slotListeners.add(cb);
  return () => slotListeners.delete(cb);
};

/** An element a page portals into: its chat ("body") or its status line ("header"). Null on the server and until the panel mounts. */
export function useChatPanelSlot(name: SlotName = "body"): HTMLElement | null {
  return useSyncExternalStore(
    subscribeSlot,
    () => slots[name],
    () => null,
  );
}

/** Whether the panel is open, for aria-expanded and button states. False on the server. */
export function useChatPanelOpen(): boolean {
  return useSyncExternalStore(subscribeChatPanel, isChatOpen, () => false);
}

const STEP = 24;

function ResizeHandle() {
  // aria-valuenow follows the real width, whichever way it changed (drag, keys, reset).
  const width = useSyncExternalStore(subscribeChatPanel, currentChatWidth, () => undefined);
  const drag = useRef<{ startX: number; startWidth: number } | undefined>(undefined);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: currentChatWidth() };
    document.documentElement.dataset.chatResizing = "";
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    // The panel is docked on the right, so dragging left (smaller x) makes it wider.
    setChatWidth(drag.current.startWidth + (drag.current.startX - e.clientX));
  };
  const end = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = undefined;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    delete document.documentElement.dataset.chatResizing;
    setChatWidth(currentChatWidth(), true);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const w = currentChatWidth();
    const next = e.key === "ArrowLeft" ? w + STEP : e.key === "ArrowRight" ? w - STEP : e.key === "Home" ? CHAT_MAX_WIDTH : e.key === "End" ? CHAT_MIN_WIDTH : undefined;
    if (next === undefined) return;
    e.preventDefault();
    setChatWidth(next, true);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the chat panel"
      aria-valuemin={CHAT_MIN_WIDTH}
      aria-valuemax={CHAT_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => resetChatWidth()}
      onKeyDown={onKeyDown}
      className="app-chat-resize group absolute inset-y-0 -left-1.5 z-10 hidden w-3 cursor-col-resize touch-none focus-visible:outline-none lg:block"
    >
      <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-transparent transition-colors group-hover:bg-foreground/25 group-focus-visible:bg-foreground/40 group-active:bg-foreground/40" />
    </div>
  );
}

export function ChatPanel() {
  // Escape closes the overlay drawer on narrow screens (the docked panel stays put).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !window.matchMedia("(min-width: 64rem)").matches) setChatOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {/* Narrow screens: backdrop behind the drawer. */}
      <div aria-hidden onClick={() => setChatOpen(false)} className="app-chat-backdrop fixed inset-0 z-40 bg-black/40 lg:hidden" />

      <aside id="chat-panel" aria-label="Ask Sawwi" className="app-chat fixed inset-y-0 right-0 z-50 flex-col border-l border-border bg-surface lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:shrink-0">
        <ResizeHandle />
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
          <ChatIcon className="size-4 shrink-0 text-muted" />
          <div className="min-w-0 flex-1 leading-tight">
            <h2 className="text-sm font-semibold">Ask Sawwi</h2>
            {/* A page's chat puts its status here ("Ask about this result", "AI off"…), so there's one header. */}
            <div ref={registerHeader} className="empty:hidden" />
          </div>
          <button
            type="button"
            onClick={() => setChatOpen(false)}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
            aria-label="Close chat"
            title="Close chat"
          >
            <CloseIcon />
          </button>
        </div>

        {/* A page's own chat (a reconciliation's) is portalled in here; otherwise the general panel shows. */}
        <div id={CHAT_SLOT_ID} ref={registerBody} className="app-chat-slot flex min-h-0 flex-1 flex-col" />
        <div className="app-chat-fallback flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col justify-end gap-3 overflow-y-auto p-4">
            <div className="rounded-xl bg-surface-muted px-3.5 py-3 text-sm">
              Hi! Soon you&apos;ll be able to ask me about all your reconciliations here, like{" "}
              <span className="font-medium">&ldquo;Which Noon orders were never paid out?&rdquo;</span>
              <p className="mt-2 text-muted">For now, open a reconciliation: its own chat appears in this panel, with questions about your files and follow-ups on the report.</p>
            </div>
          </div>
          <div className="border-t border-border p-3">
            <input
              disabled
              placeholder="Coming soon"
              aria-label="Ask Sawwi (coming soon)"
              className="h-9 w-full rounded-lg border border-border bg-surface-muted px-3 text-sm placeholder:text-muted disabled:cursor-not-allowed"
            />
          </div>
        </div>
      </aside>
    </>
  );
}
