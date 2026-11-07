import { appUrl } from "@/lib/site";

// What Sawwi's emails say and look like (D-45). Pure: data in, subject + HTML + a plain-text copy
// out, so the copy and markup are tested without sending anything.
//
// The HTML is the email people see: the app's own palette (globals.css), a header with the logo,
// a white card with a heading, figures in tiles, one button and a quiet footer. It's built from
// tables with inline styles, which is what Gmail, Outlook and Apple Mail all render the same way.
// The plain-text copy goes along as the multipart alternative: spam filters expect one, and some
// readers (watches, screen readers in text mode) show only that.

export type RenderedEmail = { subject: string; text: string; html: string };

type Tone = "neutral" | "success" | "danger" | "warn";
type Stat = { label: string; value: string; tone?: Tone };

type Block =
  | { kind: "p"; text: string }
  | { kind: "stats"; items: Stat[] }
  | { kind: "button"; href: string; label: string }
  | { kind: "note"; text: string };

type Email = {
  subject: string;
  /** Shown by inboxes next to the subject. */
  preheader: string;
  heading: string;
  blocks: Block[];
  /** Why they got it, and where to switch it off. */
  footer?: { text: string; href?: string; label?: string };
};

// The light theme from globals.css: colour only where it means something.
const C = {
  page: "#f4f4f5",
  card: "#ffffff",
  text: "#18181b",
  muted: "#71717a",
  border: "#e4e4e7",
  accent: "#18181b",
  onAccent: "#ffffff",
  tile: "#fafafa",
  tones: { neutral: "#18181b", success: "#067647", danger: "#b42318", warn: "#dc6803" } satisfies Record<Tone, string>,
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function blockHtml(b: Block): string {
  switch (b.kind) {
    case "p":
      return `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${C.text}">${esc(b.text)}</p>`;
    case "note":
      return `<p style="margin:0 0 16px;font-size:13px;line-height:20px;color:${C.muted}">${esc(b.text)}</p>`;
    case "stats": {
      const width = Math.floor(100 / b.items.length);
      const cells = b.items
        .map(
          (s, i) =>
            `<td width="${width}%" valign="top" style="padding:0 ${i < b.items.length - 1 ? "8px" : "0"} 0 0">` +
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.tile};border:1px solid ${C.border};border-radius:10px">` +
            `<tr><td style="padding:14px 16px">` +
            `<div style="font-size:12px;line-height:16px;color:${C.muted};text-transform:uppercase;letter-spacing:0.04em">${esc(s.label)}</div>` +
            `<div style="margin-top:6px;font-size:20px;line-height:26px;font-weight:600;color:${C.tones[s.tone ?? "neutral"]}">${esc(s.value)}</div>` +
            `</td></tr></table></td>`,
        )
        .join("");
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px"><tr>${cells}</tr></table>`;
    }
    case "button":
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px"><tr>` +
        `<td style="border-radius:8px;background:${C.accent}">` +
        `<a href="${esc(b.href)}" style="display:inline-block;padding:12px 20px;font-size:15px;line-height:20px;font-weight:600;color:${C.onAccent};text-decoration:none;border-radius:8px">${esc(b.label)}</a>` +
        `</td></tr></table>` +
        `<p style="margin:0 0 16px;font-size:13px;line-height:20px;color:${C.muted}">Or open this link: <a href="${esc(b.href)}" style="color:${C.muted};word-break:break-all">${esc(b.href)}</a></p>`
      );
  }
}

function blockText(b: Block): string {
  switch (b.kind) {
    case "p":
    case "note":
      return b.text;
    case "stats":
      return b.items.map((s) => `${s.label}: ${s.value}`).join("\n");
    case "button":
      return `${b.label}: ${b.href}`;
  }
}

export function layout(e: Email): RenderedEmail {
  const site = appUrl();
  const footer = e.footer
    ? `<p style="margin:0 0 8px">${esc(e.footer.text)}${e.footer.href ? ` <a href="${esc(e.footer.href)}" style="color:${C.muted};text-decoration:underline">${esc(e.footer.label ?? e.footer.href)}</a>` : ""}</p>`
    : "";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(e.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.page}">${esc(e.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:${FONT}">
<tr><td style="padding:0 4px 20px">
<a href="${esc(site)}" style="text-decoration:none;color:${C.text}">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="28" height="28" align="center" valign="middle" style="width:28px;height:28px;border-radius:8px;background:${C.accent};color:${C.onAccent};font-family:${FONT};font-size:14px;font-weight:700;line-height:28px">S</td>
<td style="padding-left:8px;font-family:${FONT};font-size:16px;font-weight:600;color:${C.text};letter-spacing:-0.01em">Sawwi</td>
</tr></table>
</a>
</td></tr>
<tr><td style="background:${C.card};border:1px solid ${C.border};border-radius:12px;padding:32px 28px">
<h1 style="margin:0 0 16px;font-size:20px;line-height:28px;font-weight:600;color:${C.text};letter-spacing:-0.01em">${esc(e.heading)}</h1>
${e.blocks.map(blockHtml).join("\n")}
</td></tr>
<tr><td style="padding:20px 4px 0;font-size:12px;line-height:18px;color:${C.muted}">
${footer}<p style="margin:0">Sawwi · Reconciliation for GCC e-commerce · <a href="${esc(site)}" style="color:${C.muted}">${esc(site.replace(/^https?:\/\//, ""))}</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  const text =
    [e.heading, ...e.blocks.map(blockText)].join("\n\n") +
    "\n\n— Sawwi\n" +
    (e.footer ? `\n${e.footer.text}${e.footer.href ? ` ${e.footer.href}` : ""}\n` : "");
  return { subject: e.subject, text, html };
}

const greeting = (name: string) => `Hi ${name.split(/\s+/)[0] || "there"},`;

const longDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

const settingsFooter = (what: string) => ({ text: `You get ${what} because they're on for your account.`, href: `${appUrl()}/settings/email`, label: "Turn them off in Settings → Email" });

// ─── Reminders (a schedule came due, D-26) ─────────────────────────────────

export type ReminderData = { name: string; workspace: string; template: string; cadence: string; dueOn: string };

export function reminderEmail(d: ReminderData): RenderedEmail {
  return layout({
    subject: `Due: ${d.template}`,
    preheader: `${d.template} is due for ${d.workspace}. Upload this period's exports to start it.`,
    heading: `${d.template} is due`,
    blocks: [
      { kind: "p", text: greeting(d.name) },
      { kind: "p", text: `It's time for this period's ${d.template} in ${d.workspace}. Nobody has started it yet.` },
      { kind: "stats", items: [{ label: "Due", value: longDay(d.dueOn) }, { label: "Repeats", value: d.cadence }] },
      { kind: "p", text: "Start it and upload this period's exports. Saved column mappings are reused, so a repeat with the same exports asks nothing." },
      { kind: "button", href: `${appUrl()}/schedules`, label: "Open schedules" },
    ],
    footer: settingsFooter("reminders"),
  });
}

// ─── "Ready to review" (a reconciliation finished) ─────────────────────────

export type ReadyData = {
  name: string;
  workspace: string;
  template: string;
  runId: string;
  ranBy: string;
  exceptions: number;
  /** Already formatted, e.g. "AED 779.00". */
  value: string;
  matched?: { rows: number; of: number };
};

export function readyEmail(d: ReadyData): RenderedEmail {
  const n = d.exceptions.toLocaleString("en-US");
  const exceptions = `${n} exception${d.exceptions === 1 ? "" : "s"}`;
  const clean = d.exceptions === 0;
  const stats: Stat[] = [
    { label: "Exceptions", value: n, tone: clean ? "success" : "danger" },
    { label: "Value", value: d.value, tone: clean ? "success" : "danger" },
  ];
  if (d.matched && d.matched.of > 0) stats.push({ label: "Rows matched", value: `${d.matched.rows.toLocaleString("en-US")} of ${d.matched.of.toLocaleString("en-US")}` });
  return layout({
    subject: clean ? `Ready to review: ${d.template}, no exceptions` : `Ready to review: ${d.template}, ${exceptions}`,
    preheader: clean ? `${d.ranBy} ran it in ${d.workspace}. Everything reconciles.` : `${d.ranBy} ran it in ${d.workspace}: ${exceptions} worth ${d.value}.`,
    heading: clean ? `${d.template}: everything reconciles` : `${d.template} is ready to review`,
    blocks: [
      { kind: "p", text: greeting(d.name) },
      { kind: "p", text: clean ? `${d.ranBy} ran ${d.template} in ${d.workspace}. No exceptions: everything reconciles.` : `${d.ranBy} ran ${d.template} in ${d.workspace}. ${exceptions} worth ${d.value}.` },
      { kind: "stats", items: stats },
      { kind: "button", href: `${appUrl()}/runs/${d.runId}`, label: "Open the report" },
    ],
    footer: settingsFooter("these notices"),
  });
}

// ─── Password reset (D-46) ─────────────────────────────────────────────────

export type ResetData = { name: string; url: string; minutes: number };

export function resetEmail(d: ResetData): RenderedEmail {
  return layout({
    subject: "Reset your Sawwi password",
    preheader: `This link works once, for the next ${d.minutes} minutes.`,
    heading: "Reset your password",
    blocks: [
      { kind: "p", text: greeting(d.name) },
      { kind: "p", text: `Someone asked to reset the password for your Sawwi account. Choose a new one with the button below. The link works once, for the next ${d.minutes} minutes.` },
      { kind: "button", href: d.url, label: "Choose a new password" },
      { kind: "note", text: "Didn't ask for this? Ignore this email: your password stays the same. Resetting it signs you out on every device." },
    ],
    footer: { text: "You get this email because a reset was requested for your account. It's sent whatever your email settings." },
  });
}

// ─── By name, for the send_email job ───────────────────────────────────────

const RENDERERS = {
  reminder: (d: Record<string, unknown>) => reminderEmail(d as ReminderData),
  ready: (d: Record<string, unknown>) => readyEmail(d as ReadyData),
  reset: (d: Record<string, unknown>) => resetEmail(d as ResetData),
} satisfies Record<string, (d: Record<string, unknown>) => RenderedEmail>;

export type EmailTemplate = keyof typeof RENDERERS;

export function renderEmail(template: string, data: Record<string, unknown>): RenderedEmail {
  const render = (RENDERERS as Record<string, ((d: Record<string, unknown>) => RenderedEmail) | undefined>)[template];
  if (!render) throw new Error(`No email template "${template}".`);
  return render(data);
}
