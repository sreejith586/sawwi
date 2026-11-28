// Every analytics event Sawwi sends, with its parameters (D-97). The catalogue is the contract:
// docs/ARCHITECTURE.md lists the same events. Parameters are categories, counts and flags only —
// never invoice contents, supplier names, amounts, VAT numbers, barcodes, emails or record IDs.
// `sanitizeParams` enforces that at runtime too, so a careless call can't leak free text.

import type { ActionKind } from "@/lib/agent/actions";

type Outcome = "ok" | "partial" | "failed";
type Location = "queue" | "review";

/** Marketing and landing calls to action, sent from `data-track-cta` attributes (see ctaAttrs). */
export type CtaId = "start_free" | "log_in" | "try_demo" | "see_how" | "choose_plan" | "open_app" | "plan_upgrade" | "template_catalogue";
export type CtaLocation = "header" | "hero" | "pricing" | "footer" | "closing" | "seo_page" | "auth" | "plan_banner" | "limit_message";

export type OnboardingStep = "about" | "channels" | "marketplace" | "webstore" | "b2b";

export type SettingName =
  | "business_profile"
  | "email_prefs"
  | "theme"
  | "member_invite"
  | "member_access"
  | "member_status"
  | "member_remove"
  | "schedule_create"
  | "schedule_pause"
  | "schedule_delete"
  | "push_target"
  | "analytics_consent";

export type AnalyticsEvents = {
  cta_click: { cta: CtaId; location: CtaLocation };
  sign_up: { invited: boolean };
  login: Record<string, never>;
  logout: Record<string, never>;
  demo_start: Record<string, never>;

  onboarding_step: { step: OnboardingStep; step_number: number; step_count: number };
  onboarding_complete: { channel_count: number; marketplace: boolean; webstore: boolean; b2b: boolean };

  connector_connect: { provider: string };
  connector_connect_failed: { provider: string };
  connector_disconnect: { provider: string };
  connector_import: { outcome: Outcome };

  reconciliation_start: { template_kind: "catalogue" | "custom" | "generic"; template?: string };
  reconciliation_upload: { file_count: number; file_type: "pdf" | "csv" | "excel" | "mixed"; outcome: Outcome };
  reconciliation_run: { outcome: Outcome; rerun: boolean };
  reconciliation_chat: { intent: string };

  invoice_upload: { count: number; ok_count: number; failed_count: number; source: "pdf" | "photo" | "sample" };
  invoice_ai_read: { count: number; ok_count: number; location: Location };
  invoice_retry: { count: number; ok_count: number; location: Location };
  invoice_link: { kind: "po" | "grn" | "rematch"; outcome: Outcome };
  invoice_match_confirm: Record<string, never>;
  invoice_approve: { count: number; ok_count: number; location: Location };
  invoice_push: { count: number; ok_count: number; failed_count: number; outcome: Outcome; location: Location };
  invoice_export: { format: "xlsx" | "csv"; scope: "selected" | "tab" | "single"; count?: number };
  invoice_delete: Record<string, never>;

  automation_approve: { automation: "settlements" | "cod"; count: number; ok_count: number };
  automation_push: { automation: "settlements" | "cod"; count: number; ok_count: number; failed_count: number; outcome: Outcome };
  automation_export: { automation: "settlements" | "cod"; format: "csv" };

  agent_message_sent: { source: "typed" | "suggestion"; turn: number };
  agent_action_proposed: { action: ActionKind; count: number };
  agent_action_confirmed: { action: ActionKind; count: number; ok_count: number; failed_count: number };
  agent_action_cancelled: { action: ActionKind; count: number };

  settings_change: { setting: SettingName; value?: string };
  plan_upgrade_click: { plan: string; action: "checkout" | "request" | "portal" };
  /** A plan limit refused something (D-99): which limit, on which plan. Categories only. */
  plan_limit_hit: { limit: "runs" | "invoices" | "members" | "connectors" | "schedules" | "ai_reads" | "agent_calls"; plan: string };
  error_shown: { area: string };
};

export type EventName = keyof AnalyticsEvents;

/** Every event name, for checking names that arrive as data (the flash cookie). */
export const EVENT_NAMES = [
  "cta_click", "sign_up", "login", "logout", "demo_start",
  "onboarding_step", "onboarding_complete",
  "connector_connect", "connector_connect_failed", "connector_disconnect", "connector_import",
  "reconciliation_start", "reconciliation_upload", "reconciliation_run", "reconciliation_chat",
  "invoice_upload", "invoice_ai_read", "invoice_retry", "invoice_link", "invoice_match_confirm", "invoice_approve", "invoice_push", "invoice_export", "invoice_delete",
  "automation_approve", "automation_push", "automation_export",
  "agent_message_sent", "agent_action_proposed", "agent_action_confirmed", "agent_action_cancelled",
  "settings_change", "plan_upgrade_click", "plan_limit_hit", "error_shown",
] as const satisfies readonly EventName[];

// The compiler checks the list is complete: a missing name makes this `false` and fails the build.
type Missing = Exclude<EventName, (typeof EVENT_NAMES)[number]>;
export const EVENT_NAMES_COMPLETE: [Missing] extends [never] ? true : false = true;

export const isEventName = (name: unknown): name is EventName => typeof name === "string" && (EVENT_NAMES as readonly string[]).includes(name);

/** Parameters required or optional, so `track("login")` needs no second argument. */
export type EventArgs<E extends EventName> = Record<string, never> extends AnalyticsEvents[E] ? [params?: AnalyticsEvents[E]] : [params: AnalyticsEvents[E]];

export type SafeValue = string | number | boolean;

// A category, a route pattern or a slug: short, no spaces, no "@". Anything else is dropped.
const SAFE_STRING = /^[A-Za-z0-9_\-./:]{1,64}$/;

/**
 * Keeps only values that can't carry client data: finite numbers, booleans and short slugs.
 * Free text (a message, a file name, an email, an amount with a currency) never passes.
 */
export function sanitizeParams(params: unknown): Record<string, SafeValue> {
  const out: Record<string, SafeValue> = {};
  if (!params || typeof params !== "object") return out;
  for (const [key, value] of Object.entries(params)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) continue;
    if (typeof value === "boolean") out[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "string" && SAFE_STRING.test(value) && !value.includes("@")) out[key] = value;
  }
  return out;
}

/** Spreads onto a link or button so the shared click listener sends `cta_click`. */
export const ctaAttrs = (cta: CtaId, location: CtaLocation) => ({ "data-track-cta": cta, "data-track-location": location });

/** ok when every item went through, failed when none did, partial in between. */
export const outcomeOf = (ok: number, total: number): Outcome => (total > 0 && ok === total ? "ok" : ok === 0 ? "failed" : "partial");
