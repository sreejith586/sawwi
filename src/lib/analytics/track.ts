// The one way Sawwi sends analytics (D-97): `track(event, params)` goes to Google Analytics 4
// (a gtag event) and Microsoft Clarity (a Clarity event plus custom tags) at once.
//
// - With no ID set, every function here does nothing: no script, no cookie, no network.
// - GA4 runs with Consent Mode v2. Until the visitor accepts, analytics_storage is "denied"
//   (cookieless pings); ad storage, ad user data and ad personalisation are always denied.
//   Clarity gets the same answer through its consent API.
// - Page paths are normalised (path.ts) and every parameter is sanitised (events.ts).

import { normalizePath } from "./path";
import { isEventName, sanitizeParams, type EventArgs, type EventName, type SafeValue } from "./events";

type Gtag = (...args: unknown[]) => void;
type Clarity = ((...args: unknown[]) => void) & { q?: unknown[][] };

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
    clarity?: Clarity;
    __sawwiAnalytics?: { ga?: boolean; clarity?: boolean; referrer?: string; lastPathname?: string };
  }
}

export type Consent = "granted" | "denied";
export const CONSENT_KEY = "sawwi-analytics-consent";
export const CONSENT_EVENT = "sawwi:analytics-consent";

// Read with literal names so Next inlines them into the browser bundle at build time.
// A malformed ID counts as unset, so nothing odd is ever put into a script URL.
export function gaMeasurementId(): string {
  const id = (process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "").trim();
  return /^G-[A-Z0-9]{4,20}$/.test(id) ? id : "";
}
export function clarityProjectId(): string {
  const id = (process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID ?? "").trim();
  return /^[a-z0-9]{6,20}$/.test(id) ? id : "";
}
export const analyticsEnabled = () => Boolean(gaMeasurementId() || clarityProjectId());

/** The visitor's choice on the banner, or null before they've made one. */
export function readConsent(): Consent | null {
  try {
    const v = window.localStorage.getItem(CONSENT_KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

const consentState = (c: Consent | null) => ({
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: c === "granted" ? "granted" : "denied",
});

/** Sets up gtag's queue once: consent defaults first, then config without an automatic page view. */
function gtag(): Gtag | undefined {
  if (typeof window === "undefined") return undefined;
  const id = gaMeasurementId();
  if (!id) return undefined;
  const state = (window.__sawwiAnalytics ??= {});
  if (!state.ga) {
    state.ga = true;
    window.dataLayer = window.dataLayer || [];
    // gtag.js reads the `arguments` object itself, so this must stay a plain function.
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    window.gtag("consent", "default", { ...consentState(readConsent()), wait_for_update: 500 });
    window.gtag("set", { url_passthrough: false, ads_data_redaction: true });
    window.gtag("js", new Date());
    window.gtag("config", id, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      ...pageFields(window.location.pathname),
    });
  }
  return window.gtag;
}

/** Sets up Clarity's queue once, with the visitor's consent. The tag script drains the queue. */
function clarity(): Clarity | undefined {
  if (typeof window === "undefined") return undefined;
  if (!clarityProjectId()) return undefined;
  const state = (window.__sawwiAnalytics ??= {});
  if (!state.clarity) {
    state.clarity = true;
    if (typeof window.clarity !== "function") {
      const q: Clarity = Object.assign(
        (...args: unknown[]) => {
          (q.q = q.q || []).push(args);
        },
        { q: [] as unknown[][] },
      );
      window.clarity = q;
    }
    window.clarity("consentv2", clarityConsent(readConsent()));
  }
  return window.clarity;
}

const clarityConsent = (c: Consent | null) => ({ ad_Storage: "denied", analytics_Storage: c === "granted" ? "granted" : "denied" });

function pageFields(pathname: string) {
  const path = normalizePath(pathname);
  return { page_location: `${window.location.origin}${path}`, page_path: path, page_title: path };
}

/** Sends one event to GA4 and Clarity. A no-op with no ID set, on the server, or for an unknown name. */
export function track<E extends EventName>(event: E, ...[params]: EventArgs<E>): void {
  if (typeof window === "undefined" || !isEventName(event)) return;
  const safe = sanitizeParams(params);
  const g = gtag();
  const c = clarity();
  if (g) g("event", event, safe);
  if (c) {
    c("event", event);
    // Custom tags make sessions filterable in Clarity (e.g. every session with a failed push).
    for (const [key, value] of Object.entries(safe) as [string, SafeValue][]) c("set", key, String(value));
  }
}

/** Sets up both queues with the visitor's consent, before either tag script runs. */
export function initAnalytics(): void {
  gtag();
  clarity();
}

/** A page view for the App Router: called on every client-side navigation with the new pathname. */
export function trackPageView(pathname: string): void {
  if (typeof window === "undefined") return;
  const g = gtag();
  if (!g) return; // Clarity follows client-side navigation by itself.
  const state = (window.__sawwiAnalytics ??= {});
  // Once per navigation, even when an effect runs twice (React's development mode).
  if (state.lastPathname === pathname) return;
  state.lastPathname = pathname;
  const fields = pageFields(pathname);
  // Only another site's origin as referrer on the first view; inside Sawwi, the previous route.
  const referrer = state.referrer ?? externalOrigin(document.referrer);
  g("set", { ...fields, page_referrer: referrer ?? "" });
  g("event", "page_view", fields);
  state.referrer = fields.page_location;
}

function externalOrigin(ref: string): string | undefined {
  try {
    const url = new URL(ref);
    return url.origin === window.location.origin ? undefined : url.origin;
  } catch {
    return undefined;
  }
}

/** Saves the banner choice and tells GA4 and Clarity straight away. */
export function setConsent(choice: Consent): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONSENT_KEY, choice);
  } catch {
    // Storage off: the choice holds for this page only.
  }
  gtag()?.("consent", "update", consentState(choice));
  clarity()?.("consentv2", clarityConsent(choice));
  window.dispatchEvent(new Event(CONSENT_EVENT));
}

/** Forgets the choice, so the banner asks again (the "Cookie settings" link). */
export function clearConsent(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CONSENT_KEY);
  } catch {
    // Nothing stored.
  }
  window.dispatchEvent(new Event(CONSENT_EVENT));
}
