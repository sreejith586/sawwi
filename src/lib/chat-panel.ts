// Right-hand chat panel ("Ask Sawwi") state. Same pattern as the left sidebar (lib/sidebar.ts):
// an inline <head> script sets <html data-chat="open"> and the --chat-width variable before first
// paint, and CSS (.app-chat in globals.css) does the layout, so the panel never jumps on load.
// No React here (the root layout imports the script): components read the state through the
// hooks in components/shell/chat-panel.tsx, which listen for CHAT_EVENT.

export const CHAT_STORAGE_KEY = "sawwi-chat";
export const CHAT_DEFAULT_WIDTH = 384;
export const CHAT_MIN_WIDTH = 300;
export const CHAT_MAX_WIDTH = 720;
/** The panel never takes more than this share of the window, so the page stays usable. */
const MAX_SHARE = 0.6;
/** Fired on window whenever the panel opens, closes, resizes or asks for attention. */
export const CHAT_EVENT = "sawwi-chat-panel";

type Saved = { open?: boolean; width?: number };

/** From this width the panel docks beside the page; below it, it is a drawer over the page. */
export const CHAT_DOCK_QUERY = "(min-width: 64rem)";
/** A reconciliation's page: the panel opens there by default when it can dock (D-34). */
export const RUN_PATH = /^\/runs\/[^/]+/;

// Open if the user left it open, or on a run page when it can dock (not saved: leaving the run
// restores the user's own choice).
export const CHAT_PANEL_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem("${CHAT_STORAGE_KEY}")||"{}");var r=document.documentElement;if(s.open||(${RUN_PATH}.test(location.pathname)&&matchMedia("${CHAT_DOCK_QUERY}").matches))r.dataset.chat="open";if(typeof s.width==="number")r.style.setProperty("--chat-width",Math.max(${CHAT_MIN_WIDTH},Math.min(${CHAT_MAX_WIDTH},s.width))+"px")}catch(e){}})()`;

/** Keeps a width inside the limits for this window. */
export function clampChatWidth(width: number, viewport: number): number {
  const max = Math.max(CHAT_MIN_WIDTH, Math.min(CHAT_MAX_WIDTH, Math.floor(viewport * MAX_SHARE)));
  return Math.round(Math.min(max, Math.max(CHAT_MIN_WIDTH, width)));
}

function read(): Saved {
  try {
    return JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) ?? "{}") as Saved;
  } catch {
    return {};
  }
}

function save(patch: Saved) {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify({ ...read(), ...patch }));
  } catch {
    // Blocked storage: the panel still works until the next reload.
  }
}

export function isChatOpen(): boolean {
  return document.documentElement.dataset.chat === "open";
}

/** Opens or closes the panel. The user's own toggles are saved; a page opening it by default is not. */
export function setChatOpen(open: boolean, persist = true) {
  const root = document.documentElement;
  if (persist) save({ open });
  if (open === isChatOpen()) return;
  if (open) root.dataset.chat = "open";
  else delete root.dataset.chat;
  window.dispatchEvent(new Event(CHAT_EVENT));
}

/** Back to the user's saved choice, e.g. when leaving a page that opened the panel by default. */
export function restoreChatOpen() {
  setChatOpen(Boolean(read().open), false);
}

/** Whether the panel docks beside the page at this window width. */
export const chatCanDock = () => window.matchMedia(CHAT_DOCK_QUERY).matches;

export const toggleChatPanel = () => setChatOpen(!isChatOpen());

export function currentChatWidth(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--chat-width");
  const px = Number.parseFloat(raw);
  return Number.isFinite(px) ? px : CHAT_DEFAULT_WIDTH;
}

/** Sets the width live (while dragging); pass persist to remember it. */
export function setChatWidth(width: number, persist = false) {
  const w = clampChatWidth(width, window.innerWidth);
  document.documentElement.style.setProperty("--chat-width", `${w}px`);
  if (persist) save({ width: w });
  window.dispatchEvent(new Event(CHAT_EVENT));
  return w;
}

export function resetChatWidth() {
  return setChatWidth(CHAT_DEFAULT_WIDTH, true);
}

/** Marks that the chat needs the user (an open question) while the panel is closed. */
export function setChatAttention(on: boolean) {
  const root = document.documentElement;
  if (on === (root.dataset.chatAttention !== undefined)) return;
  if (on) root.dataset.chatAttention = "";
  else delete root.dataset.chatAttention;
  window.dispatchEvent(new Event(CHAT_EVENT));
}

/** Calls back whenever the panel opens, closes, resizes or asks for attention. */
export function subscribeChatPanel(cb: () => void): () => void {
  window.addEventListener(CHAT_EVENT, cb);
  return () => window.removeEventListener(CHAT_EVENT, cb);
}
