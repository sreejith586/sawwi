"use client";

import { track } from "@/lib/analytics/track";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { buttonClass } from "@/components/ui";
import type { AgentAction } from "@/lib/agent/actions";
import type { AgentEvent } from "@/lib/agent/agent";

// The chat agent in the right-hand panel (D-96): ask in plain words, and it looks up, fixes and
// proposes. Steps show as they happen; actions that need a person (approve, push, AI reading,
// delete…) arrive as cards with Confirm and Cancel. The conversation is kept for this browser tab.

type Item =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "step"; summary: string; ok: boolean }
  | { kind: "action"; action: AgentAction }
  | { kind: "error"; text: string };

type Saved = { items: Item[]; transcript: unknown[]; notes: string[] };
const STORE = "sawwi-agent-chat";

const SUGGESTIONS = [
  "What needs my attention?",
  "Approve everything that's ready",
  "Which invoices still need their PO match confirmed?",
  "Why is invoice 4292 blocked?",
  "Download all approved invoices as Excel",
];

/** Just enough markdown for the agent's answers: paragraphs, bullets, bold, and links inside Sawwi. */
function Markdown({ text }: { text: string }) {
  const inline = (s: string, key: string): ReactNode[] =>
    // Bold first, so a link inside bold text still becomes a link.
    s.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|`[^`]+`)/g).map((part, i) => {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      if (link) {
        const href = link[2];
        // Only links inside Sawwi: a supplier's text can't send the user elsewhere.
        const inside = href.startsWith("/") && !href.startsWith("//");
        // Downloads (Excel, CSV, PDFs) are files, not pages: a plain link, not the app's router.
        if (inside && href.startsWith("/api/")) {
          return (
            <a key={`${key}${i}`} href={href} className="font-medium underline underline-offset-4" download>
              {link[1]}
            </a>
          );
        }
        return inside ? (
          <Link key={`${key}${i}`} href={href} className="font-medium underline underline-offset-4" prefetch={false}>
            {link[1]}
          </Link>
        ) : (
          <Fragment key={`${key}${i}`}>{link[1]}</Fragment>
        );
      }
      if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={`${key}${i}`}>{inline(part.slice(2, -2), `${key}${i}b`)}</strong>;
      if (/^`[^`]+`$/.test(part)) return <code key={`${key}${i}`} className="rounded bg-surface px-1 text-xs">{part.slice(1, -1)}</code>;
      return <Fragment key={`${key}${i}`}>{part}</Fragment>;
    });
  return (
    <>
      {text
        .trim()
        .split(/\n{2,}/)
        .map((block, b) => {
          const lines = block.split("\n");
          if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
            return (
              <ul key={b} className="my-1 list-disc space-y-0.5 pl-5">
                {lines.map((l, i) => (
                  <li key={i}>{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ""), `${b}-${i}-`)}</li>
                ))}
              </ul>
            );
          }
          return (
            <p key={b} className="my-1">
              {lines.map((l, i) => (
                <Fragment key={i}>
                  {i > 0 && <br />}
                  {inline(l.replace(/^#+\s*/, ""), `${b}-${i}-`)}
                </Fragment>
              ))}
            </p>
          );
        })}
    </>
  );
}

function ActionCard({ action, onDecided }: { action: AgentAction; onDecided: (a: AgentAction) => void }) {
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decide = async (decision: "confirm" | "cancel") => {
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch(`/api/agent/actions/${action.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
      const json = (await res.json()) as { action?: AgentAction; error?: string };
      if (json.action) {
        const count = json.action.invoices.length;
        if (json.action.status === "cancelled") track("agent_action_cancelled", { action: json.action.kind, count });
        else {
          const ok = json.action.results?.filter((r) => r.ok).length ?? 0;
          track("agent_action_confirmed", { action: json.action.kind, count, ok_count: ok, failed_count: (json.action.results?.length ?? 0) - ok });
        }
      }
      if (json.error) setError(json.error);
      if (json.action) onDecided(json.action);
    } catch {
      setError("That didn't go through. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };
  const pending = action.status === "pending";
  return (
    <div className="rounded-xl border border-brand/40 bg-surface p-3">
      <p className="font-medium">{action.title}</p>
      <p className="mt-0.5 text-xs text-muted">{action.effect}</p>
      <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
        {action.invoices.map((i) => {
          const r = action.results?.find((x) => x.label === i.label);
          return (
            <li key={i.id} className="flex justify-between gap-2">
              <span className="min-w-0">
                <Link href={`/automation/purchase-invoices/${i.id}`} className="underline-offset-4 hover:underline" prefetch={false}>
                  {i.label}
                </Link>
                {i.note && !r && <span className="block text-muted">{i.note}</span>}
                {r && <span className={`block ${r.ok ? "text-success" : "text-danger"}`}>{r.ok ? "✓" : "✕"} {r.message}</span>}
              </span>
              <span className="shrink-0 tabular-nums text-muted">{i.total}</span>
            </li>
          );
        })}
      </ul>
      {action.results?.filter((r) => !action.invoices.some((i) => i.label === r.label)).map((r, k) => (
        <p key={k} className={`mt-1 text-xs ${r.ok ? "text-success" : "text-danger"}`}>
          {r.message}
        </p>
      ))}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {pending ? (
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => decide("confirm")} disabled={busy !== null} className={buttonClass("primary")}>
            {busy === "confirm" ? "Working…" : "Confirm"}
          </button>
          <button type="button" onClick={() => decide("cancel")} disabled={busy !== null} className={buttonClass("secondary")}>
            Cancel
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">{action.status === "cancelled" ? "Cancelled." : "Done."}</p>
      )}
    </div>
  );
}

export function AgentChat({ fallback }: { fallback: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<{ available: boolean; reason?: string; canEdit?: boolean } | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [transcript, setTranscript] = useState<unknown[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [working, setWorking] = useState(false);
  // Nothing is saved until the tab's earlier chat has been restored, or an empty chat would overwrite it.
  const [restored, setRestored] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void fetch("/api/agent")
      .then((r) => r.json())
      .then((s: { available: boolean; reason?: string; canEdit?: boolean }) => {
        if (!live) return;
        setState(s);
        // This tab's conversation, if there was one (the panel survives page changes, not reloads).
        try {
          const saved = JSON.parse(sessionStorage.getItem(STORE) ?? "null") as Saved | null;
          if (saved && s.available) {
            setItems(saved.items);
            setTranscript(saved.transcript);
            setNotes(saved.notes);
          }
        } catch {
          // No saved chat: start fresh.
        }
        setRestored(true);
      })
      .catch(() => live && setState({ available: false }));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ items, transcript, notes } satisfies Saved));
    } catch {
      // Storage full or off: the chat still works for this page.
    }
  }, [items, transcript, notes, restored]);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, working]);

  if (state && !state.available) return <>{fallback}</>;

  const send = async (message: string, source: "typed" | "suggestion" = "typed") => {
    const t = message.trim();
    if (!t || working) return;
    // Never the message itself: only how it was sent and how far into the chat.
    track("agent_message_sent", { source, turn: items.filter((i) => i.kind === "user").length + 1 });
    setText("");
    setWorking(true);
    setItems((x) => [...x, { kind: "user", text: t }]);
    // Results of actions the user confirmed since the last message, so the agent knows what happened.
    const said = notes.length ? `${notes.join("\n")}\n\n${t}` : t;
    setNotes([]);
    try {
      const res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: transcript, text: said }) });
      if (!res.ok || !res.body) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setItems((x) => [...x, { kind: "error", text: json.error ?? "The assistant didn't answer. Try again." }]);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const e = JSON.parse(line) as AgentEvent;
          if (e.type === "text") setItems((x) => [...x, { kind: "assistant", text: e.text }]);
          else if (e.type === "step") setItems((x) => [...x, { kind: "step", summary: e.summary, ok: e.ok }]);
          else if (e.type === "proposal") {
            track("agent_action_proposed", { action: e.action.kind, count: e.action.invoices.length });
            setItems((x) => [...x, { kind: "action", action: e.action }]);
          }
          else if (e.type === "changed") router.refresh();
          else if (e.type === "done") setTranscript(e.messages);
          else if (e.type === "error") setItems((x) => [...x, { kind: "error", text: e.message }]);
        }
      }
    } catch {
      setItems((x) => [...x, { kind: "error", text: "The connection dropped. Try again." }]);
    } finally {
      setWorking(false);
    }
  };

  const decided = (a: AgentAction) => {
    setItems((x) => x.map((i) => (i.kind === "action" && i.action.id === a.id ? { ...i, action: a } : i)));
    const summary = a.status === "cancelled" ? "cancelled it" : `confirmed it. Results: ${(a.results ?? []).map((r) => `${r.label}: ${r.ok ? "done" : "not done"}, ${r.message}`).join("; ")}`;
    setNotes((n) => [...n, `[Note from Sawwi: the user ${summary} — "${a.title}".]`]);
    router.refresh();
  };

  const reset = () => {
    setItems([]);
    setTranscript([]);
    setNotes([]);
  };

  return (
    <>
      <div ref={listRef} className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-4 text-sm">
        <div className="mt-auto rounded-2xl rounded-bl-md bg-surface-muted px-3.5 py-2.5 leading-relaxed">
          Hi! I can look through your purchase invoices, explain what&apos;s blocking them, fix their PO and GRN matches, and line up approvals, pushes and
          exports for you to confirm. What would you like to do?
          {state?.canEdit === false && <span className="mt-1 block text-xs text-muted">You have view access, so I can look things up but not change them.</span>}
        </div>
        {items.map((it, i) =>
          it.kind === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-accent-foreground">{it.text}</p>
            </div>
          ) : it.kind === "assistant" ? (
            <div key={i} className="max-w-[92%] rounded-2xl rounded-bl-md bg-surface-muted px-3.5 py-2 leading-relaxed">
              <Markdown text={it.text} />
            </div>
          ) : it.kind === "step" ? (
            <p key={i} className={`px-1 text-xs ${it.ok ? "text-muted" : "text-danger"}`}>
              {it.ok ? "·" : "✕"} {it.summary}
            </p>
          ) : it.kind === "action" ? (
            <ActionCard key={it.action.id} action={it.action} onDecided={decided} />
          ) : (
            <p key={i} role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
              {it.text}
            </p>
          ),
        )}
        {working && (
          <p className="px-1 text-xs text-muted" role="status">
            Working…
          </p>
        )}
        {items.length === 0 && state?.available && (
          <div className="space-y-1.5 pt-1">
            <p className="text-xs font-medium text-muted">Try</p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s, "suggestion")}
                className="block w-full rounded-lg border border-border bg-surface px-3 py-2 text-left transition hover:border-foreground/40 hover:bg-surface-muted"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
      <form
        className="border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!state?.available || working}
            placeholder={state?.available ? "Ask or tell Sawwi what to do…" : "Loading…"}
            aria-label="Message Sawwi"
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm placeholder:text-muted"
          />
          <button type="submit" disabled={!text.trim() || working} className={buttonClass("primary")}>
            Send
          </button>
        </div>
        {items.length > 0 && (
          <button type="button" onClick={reset} disabled={working} className="mt-2 text-xs text-muted underline-offset-4 hover:underline">
            New chat
          </button>
        )}
      </form>
    </>
  );
}
