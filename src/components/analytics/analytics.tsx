"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { buttonClass } from "@/components/ui";
import type { CtaId, CtaLocation } from "@/lib/analytics/events";
import { FLASH_COOKIE, parseFlash } from "@/lib/analytics/flash";
import { CLARITY_EXCLUDED, normalizePath } from "@/lib/analytics/path";
import {
  analyticsEnabled,
  clarityProjectId,
  clearConsent,
  CONSENT_EVENT,
  gaMeasurementId,
  initAnalytics,
  readConsent,
  setConsent,
  track,
  trackPageView,
} from "@/lib/analytics/track";

// Google Analytics 4 and Microsoft Clarity for the whole app (D-97). Renders nothing, loads
// nothing and sets no cookie unless NEXT_PUBLIC_GA_MEASUREMENT_ID or NEXT_PUBLIC_CLARITY_PROJECT_ID
// is set. Sends page views on client-side navigation, events the server queued before a
// redirect, clicks on marked calls to action, and every error alert shown to the user.

function readFlashCookie(): string | undefined {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${FLASH_COOKIE}=`));
  return hit?.slice(FLASH_COOKIE.length + 1);
}

function sendFlashedEvents() {
  const raw = readFlashCookie();
  if (!raw) return;
  document.cookie = `${FLASH_COOKIE}=; path=/; max-age=0; samesite=lax`;
  for (const [name, params] of parseFlash(raw)) track(name, params as never);
}

export function Analytics() {
  const pathname = usePathname();
  const ga = gaMeasurementId();
  const clarityId = clarityProjectId();
  const enabled = analyticsEnabled();

  // A page view on first load and on every client-side navigation, then anything the server queued.
  useEffect(() => {
    if (!enabled) return;
    initAnalytics();
    trackPageView(pathname);
    sendFlashedEvents();
  }, [enabled, pathname]);

  // Calls to action marked with data-track-cta (marketing pages are server-rendered, so one listener).
  useEffect(() => {
    if (!enabled) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const cta = target?.closest?.<HTMLElement>("[data-track-cta]");
      if (cta) track("cta_click", { cta: cta.dataset.trackCta as CtaId, location: cta.dataset.trackLocation as CtaLocation });
      // Server-rendered billing buttons (Manage billing opens the Stripe portal).
      const upgrade = target?.closest?.<HTMLElement>("[data-track-upgrade]");
      if (upgrade) track("plan_upgrade_click", { plan: upgrade.dataset.trackPlan ?? "unknown", action: "portal" });
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [enabled]);

  // Errors shown to the user: every one is a role="alert". Only the route is sent, never the message.
  useEffect(() => {
    if (!enabled) return;
    const seen = new WeakMap<Element, string>();
    const check = () => {
      for (const el of document.querySelectorAll('[role="alert"]')) {
        const text = el.textContent?.trim() ?? "";
        if (!text || seen.get(el) === text) continue;
        seen.set(el, text);
        track("error_shown", { area: normalizePath(window.location.pathname) });
      }
    };
    check();
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        check();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [enabled]);

  if (!enabled) return null;
  const loadClarity = Boolean(clarityId) && !CLARITY_EXCLUDED.some((p) => pathname.startsWith(p));
  return (
    <>
      {/* The queues and consent defaults are set up in track.ts before the first call, so only the tags load here. */}
      {ga && <Script id="sawwi-ga4-tag" src={`https://www.googletagmanager.com/gtag/js?id=${ga}`} strategy="afterInteractive" />}
      {loadClarity && <Script id="sawwi-clarity-tag" src={`https://www.clarity.ms/tag/${clarityId}`} strategy="afterInteractive" />}
      <ConsentBanner />
    </>
  );
}

function subscribeConsent(cb: () => void) {
  window.addEventListener(CONSENT_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CONSENT_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** Asks once whether analytics may use cookies. Until "Accept", GA4 and Clarity run cookieless. */
function ConsentBanner() {
  // "unset" on the server and before hydration, so the banner never flashes for someone who chose.
  const choice = useSyncExternalStore(subscribeConsent, () => readConsent() ?? "none", () => "unset");
  if (choice !== "none") return null;
  return (
    <div role="dialog" aria-label="Cookies" className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-xl rounded-xl border border-border bg-surface p-4 text-sm shadow-lg sm:inset-x-auto sm:left-1/2 sm:w-[36rem] sm:-translate-x-1/2">
      <p className="font-medium">Analytics cookies</p>
      <p className="mt-1 text-muted">
        Sawwi uses Google Analytics and Microsoft Clarity to see which features are used and where people get stuck. They never see your invoices,
        reports or other data, and screens with your data are masked. Accept to let them set cookies; decline and they run without cookies.
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className={buttonClass("secondary")} onClick={() => setConsent("denied")}>
          Decline
        </button>
        <button type="button" className={buttonClass("primary")} onClick={() => setConsent("granted")}>
          Accept
        </button>
      </div>
    </div>
  );
}

/** "Cookie settings": forgets the choice so the banner asks again. Hidden when analytics is off. */
export function CookieSettingsButton({ className = "" }: { className?: string }) {
  if (!analyticsEnabled()) return null;
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        clearConsent();
        track("settings_change", { setting: "analytics_consent" });
      }}
    >
      Cookie settings
    </button>
  );
}
