"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatIntent } from "@/lib/insights/chat";
import { ExcelButton, SeverityDot } from "@/components/data-table";
import type { RunView } from "@/lib/runs/view";
import type { ChatPayload, Message } from "@/lib/runs/types";

// The run's conversation: setup questions while files are mapped, then one-click follow-ups
// (fix first, breakdowns, email drafts, explanations) and free text once there's a report.

const money = (n: number, currency?: string) =>
  `${currency ? `${currency} ` : ""}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function Chat({
  view,
  busy,
  thinking,
  onAnswer,
  onIntent,
}: {
  view: RunView;
  busy: boolean;
  /** A follow-up is being answered (may call the AI, so it can take a few seconds). */
  thinking: boolean;
  onAnswer: (questionId: string, value: string) => void;
  onIntent: (intent: ChatIntent) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const current = view.openQuestions[0];

  // Scroll only the chat panel, never the page: the report above should stay in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view.messages.length, current?.id, thinking]);

  const followUps = Boolean(view.report && view.insights && !current);

  return (
    // Fills the right-hand chat panel (components/shell/chat-panel.tsx), which the run page portals it into.
    <section aria-label="Reconciliation chat" className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <span className="grid size-7 place-items-center rounded-full bg-accent text-xs font-bold text-accent-foreground">S</span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-sm font-semibold">Sawwi</p>
          <p className="text-xs text-muted">{thinking ? "Thinking…" : busy ? "Working…" : current ? "Waiting for your answer" : followUps ? "Ask about this result" : "Here to help"}</p>
        </div>
        {followUps && !view.insights!.ai && (
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-muted" title="No API key is set, so answers are written by Sawwi's rules.">
            AI off
          </span>
        )}
      </div>
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        <Bubble role="sawwi">Upload each file on the left. I&apos;ll read them, match the columns, and only ask when something is unclear.</Bubble>
        {view.messages.map((m) => (
          <MessageView key={m.id} message={m} runId={view.id} />
        ))}
        {thinking && (
          <div className="flex">
            <p className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-surface-muted px-3.5 py-3" aria-label="Sawwi is writing">
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1.5 animate-pulse rounded-full bg-muted" style={{ animationDelay: `${i * 150}ms` }} />
              ))}
            </p>
          </div>
        )}
        {current && (
          <div className="space-y-2.5">
            <Bubble role="sawwi" highlight>
              {current.prompt}
            </Bubble>
            <div className="flex flex-wrap gap-2">
              {current.options.map((o) => (
                <ChipButton key={o.value} disabled={busy} onClick={() => onAnswer(current.id, o.value)}>
                  {o.label}
                </ChipButton>
              ))}
            </div>
            {view.openQuestions.length > 1 && <p className="text-xs text-muted">{view.openQuestions.length - 1} more after this</p>}
          </div>
        )}
      </div>
      {followUps && <FollowUps view={view} disabled={busy || thinking} onIntent={onIntent} />}
      {view.usage.calls > 0 && (
        <div className="tabular border-t border-border px-4 py-2 text-[11px] text-muted">
          AI calls {view.usage.calls} · in {view.usage.inputTokens.toLocaleString()} · cached {view.usage.cacheReadTokens.toLocaleString()} · out{" "}
          {view.usage.outputTokens.toLocaleString()}
        </div>
      )}
    </section>
  );
}

function ChipButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-full border border-border bg-surface px-3 py-1.5 text-left text-xs font-medium shadow-sm transition hover:border-foreground/50 hover:bg-surface-muted disabled:opacity-50"
    >
      {children}
    </button>
  );
}

// ─── Follow-up actions ──────────────────────────────────────────────────────

function FollowUps({ view, disabled, onIntent }: { view: RunView; disabled: boolean; onIntent: (i: ChatIntent) => void }) {
  const insights = view.insights!;
  const [text, setText] = useState("");
  const [more, setMore] = useState(false);
  const top = insights.checks[0];
  const audienceLabel = insights.audiences.find((a) => a.key === insights.audience)?.label ?? "counterparty";
  const biggest = useMemo(() => {
    const ex = view.report?.exceptions ?? [];
    return ex.length ? ex.reduce((a, b) => (b.value > a.value ? b : a)) : undefined;
  }, [view.report]);
  const topDim = top?.dims.find((d) => d.key !== "key") ?? top?.dims[0];

  const submit = () => {
    const q = text.trim();
    if (!q) return;
    onIntent({ kind: "ask", text: q });
    setText("");
  };

  return (
    <div className="space-y-2.5 border-t border-border bg-surface-muted/30 p-3">
      {top ? (
        <div className="flex flex-wrap gap-1.5">
          <ChipButton disabled={disabled} onClick={() => onIntent({ kind: "fix_first" })}>
            What should I fix first?
          </ChipButton>
          {topDim && (
            <ChipButton disabled={disabled} onClick={() => onIntent({ kind: "breakdown", check: top.id, by: topDim.key })}>
              Break down {top.label.toLowerCase()} by {topDim.label.toLowerCase()}
            </ChipButton>
          )}
          <ChipButton disabled={disabled} onClick={() => onIntent({ kind: "email", check: top.id })}>
            Draft email to {audienceLabel} about {top.label.toLowerCase()}
          </ChipButton>
          {biggest && (
            <ChipButton disabled={disabled} onClick={() => onIntent({ kind: "explain", exception: biggest.id })}>
              Explain {biggest.key}
            </ChipButton>
          )}
          <button type="button" onClick={() => setMore(!more)} className="px-1.5 py-1.5 text-xs font-medium text-muted hover:text-foreground" aria-expanded={more}>
            {more ? "Fewer options" : "More…"}
          </button>
        </div>
      ) : (
        <p className="text-xs text-success">Everything reconciles: there is nothing to follow up.</p>
      )}
      {more && top && <MoreActions view={view} disabled={disabled} onIntent={onIntent} />}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder={insights.ai ? "Ask about this result…" : "Free text needs AI; use the chips"}
          aria-label="Ask Sawwi about this result"
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm outline-none placeholder:text-muted focus:border-foreground/40"
        />
        <button
          type="submit"
          disabled={disabled || !text.trim()}
          className="h-9 rounded-lg bg-accent px-3 text-sm font-medium text-accent-foreground shadow-sm hover:bg-accent-strong disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}

const selectClass = "h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-xs outline-none focus:border-foreground/40";

function MoreActions({ view, disabled, onIntent }: { view: RunView; disabled: boolean; onIntent: (i: ChatIntent) => void }) {
  const insights = view.insights!;
  const [check, setCheck] = useState(insights.checks[0].id);
  const dims = insights.checks.find((c) => c.id === check)?.dims ?? [];
  const [by, setBy] = useState(dims[0]?.key ?? "key");
  const [audience, setAudience] = useState(insights.audience);
  const dim = dims.some((d) => d.key === by) ? by : dims[0]?.key;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface p-2.5">
      <label className="flex items-center gap-2 text-xs text-muted">
        <span className="w-12 shrink-0">Check</span>
        <select value={check} onChange={(e) => setCheck(e.target.value)} className={selectClass}>
          {insights.checks.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} ({c.count})
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="w-12 shrink-0">By</span>
        <select value={dim} onChange={(e) => setBy(e.target.value)} className={selectClass} aria-label="Break down by">
          {dims.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
        </select>
        <ChipButton disabled={disabled || !dim} onClick={() => dim && onIntent({ kind: "breakdown", check, by: dim })}>
          Break down
        </ChipButton>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="w-12 shrink-0">To</span>
        <select value={audience} onChange={(e) => setAudience(e.target.value)} className={selectClass} aria-label="Email recipient">
          {insights.audiences.map((a) => (
            <option key={a.key} value={a.key}>
              {a.label.charAt(0).toUpperCase() + a.label.slice(1)}
            </option>
          ))}
        </select>
        <ChipButton disabled={disabled} onClick={() => onIntent({ kind: "email", check, audience })}>
          Draft email
        </ChipButton>
      </div>
    </div>
  );
}

// ─── Messages ───────────────────────────────────────────────────────────────

function MessageView({ message, runId }: { message: Message; runId: string }) {
  const p = message.payload;
  if (!p || p.type === "question" || p.type === "answer") {
    return (
      <Bubble role={message.role} tag={p?.type === "answer" && p.source === "ai" ? "AI" : undefined}>
        {message.body}
      </Bubble>
    );
  }
  return (
    <div className="space-y-2">
      <Bubble role="sawwi" tag={p.source === "ai" ? "AI" : undefined}>
        {message.body}
      </Bubble>
      {p.type === "email" && <EmailCard email={p} />}
      {p.type === "breakdown" && <BreakdownCard data={p} runId={runId} />}
      {p.type === "fix_first" && <FixFirstCard data={p} />}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-xl border border-border bg-surface text-sm shadow-sm">{children}</div>;
}

function EmailCard({ email }: { email: Extract<ChatPayload, { type: "email" }> }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${email.subject}\n\n${email.body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Card>
      <div className="flex items-start gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wide text-muted">To the {email.audience}</p>
          <p className="mt-0.5 font-medium">{email.subject}</p>
        </div>
        <button
          type="button"
          onClick={copy}
          className="h-7 shrink-0 rounded-md border border-border px-2 text-xs font-medium hover:bg-surface-muted"
          aria-label="Copy email to clipboard"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap px-3 py-2.5 font-sans text-[13px] leading-relaxed">{email.body}</pre>
    </Card>
  );
}

const PREVIEW_ROWS = 8;

function BreakdownCard({ data, runId }: { data: Extract<ChatPayload, { type: "breakdown" }>; runId: string }) {
  const [all, setAll] = useState(false);
  const rows = all ? data.rows : data.rows.slice(0, PREVIEW_ROWS);
  const max = Math.max(...data.rows.map((r) => r.value), 0);
  const href = `/api/runs/${runId}/breakdown?check=${encodeURIComponent(data.check)}&by=${encodeURIComponent(data.by)}`;
  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-xs font-medium">
          {data.checkLabel} by {data.byLabel.toLowerCase()}
        </p>
        <ExcelButton href={href} />
      </div>
      <table className="w-full text-xs">
        <thead className="text-left text-muted">
          <tr>
            <th className="px-3 py-1.5 font-medium">{data.byLabel}</th>
            <th className="px-2 py-1.5 text-right font-medium">Items</th>
            <th className="px-3 py-1.5 text-right font-medium">Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.group}>
              <td className="max-w-32 px-3 py-1.5">
                <span className="block truncate font-mono" title={r.group}>
                  {r.group}
                </span>
                {max > 0 && (
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-muted">
                    <span className="block h-full rounded-full bg-danger/70" style={{ width: `${(r.value / max) * 100}%` }} />
                  </span>
                )}
              </td>
              <td className="tabular px-2 py-1.5 text-right">{r.count.toLocaleString("en-US")}</td>
              <td className={`tabular px-3 py-1.5 text-right font-medium ${r.value ? "text-danger" : "text-muted"}`}>{r.value ? money(r.value) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(data.rows.length > PREVIEW_ROWS || data.totalGroups > data.rows.length) && (
        <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[11px] text-muted">
          <span>
            {rows.length} of {data.totalGroups.toLocaleString("en-US")} {data.currency ? `· ${data.currency}` : ""}
          </span>
          {data.rows.length > PREVIEW_ROWS && (
            <button type="button" onClick={() => setAll(!all)} className="font-medium hover:text-foreground">
              {all ? "Show fewer" : "Show more"}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

function FixFirstCard({ data }: { data: Extract<ChatPayload, { type: "fix_first" }> }) {
  return (
    <Card>
      <ol className="divide-y divide-border">
        {data.items.map((item, i) => (
          <li key={item.checkLabel} className="flex gap-2.5 px-3 py-2.5">
            <span className="tabular mt-px grid size-5 shrink-0 place-items-center rounded-full bg-surface-muted text-[11px] font-semibold">{i + 1}</span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-medium">
                <SeverityDot tone={item.severity} />
                <span className="truncate">{item.checkLabel}</span>
              </p>
              <p className="tabular mt-0.5 text-xs text-muted">
                {item.count.toLocaleString("en-US")} items{item.value ? ` · ${money(item.value)}` : ""}
              </p>
              <p className="mt-1 text-xs leading-relaxed">{item.action}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Bubble({ role, children, highlight = false, tag }: { role: "sawwi" | "user"; children: React.ReactNode; highlight?: boolean; tag?: string }) {
  return (
    <div className={role === "user" ? "flex justify-end" : "flex"}>
      <div
        className={`max-w-[88%] whitespace-pre-line rounded-2xl px-3.5 py-2 leading-relaxed ${
          role === "user" ? "rounded-br-md bg-accent text-accent-foreground" : "rounded-bl-md bg-surface-muted"
        } ${highlight ? "ring-1 ring-foreground/20" : ""}`}
      >
        {children}
        {tag && <span className="ml-1.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-muted">{tag}</span>}
      </div>
    </div>
  );
}
