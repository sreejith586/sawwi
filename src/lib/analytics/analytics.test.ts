import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_NAMES_COMPLETE, outcomeOf, sanitizeParams } from "./events";
import { encodeFlash, parseFlash } from "./flash";
import { normalizePath } from "./path";
import { analyticsEnabled, clarityProjectId, gaMeasurementId, setConsent, track, trackPageView } from "./track";

type FakeWindow = {
  location: { origin: string; pathname: string };
  localStorage: Storage;
  dispatchEvent: (e: Event) => boolean;
  dataLayer?: unknown[];
  gtag?: unknown;
  clarity?: ((...args: unknown[]) => void) & { q?: unknown[][] };
  __sawwiAnalytics?: unknown;
};

function fakeWindow(pathname = "/home"): FakeWindow {
  const store = new Map<string, string>();
  return {
    location: { origin: "https://sawwiapp.ai", pathname },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
    dispatchEvent: () => true,
  };
}

let win: FakeWindow;
// gtag pushes `arguments` objects; compare them as arrays.
const gaCalls = () => (win.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>));
const clarityCalls = () => win.clarity?.q ?? [];

beforeEach(() => {
  win = fakeWindow();
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", { referrer: "" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("with no IDs set", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "");
    vi.stubEnv("NEXT_PUBLIC_CLARITY_PROJECT_ID", "");
  });

  it("is off and track() does nothing at all", () => {
    expect(analyticsEnabled()).toBe(false);
    track("invoice_upload", { count: 3, ok_count: 3, failed_count: 0, source: "pdf" });
    trackPageView("/home");
    setConsent("granted");
    expect(win.dataLayer).toBeUndefined();
    expect(win.gtag).toBeUndefined();
    expect(win.clarity).toBeUndefined();
  });

  it("ignores malformed IDs, so nothing odd reaches a script URL", () => {
    vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "G-ABC123\"><script>");
    vi.stubEnv("NEXT_PUBLIC_CLARITY_PROJECT_ID", "../evil");
    expect(gaMeasurementId()).toBe("");
    expect(clarityProjectId()).toBe("");
    expect(analyticsEnabled()).toBe(false);
  });
});

describe("track() with GA4 and Clarity", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "G-TEST1234");
    vi.stubEnv("NEXT_PUBLIC_CLARITY_PROJECT_ID", "abc123xyz");
  });

  it("sets consent defaults to denied before anything else, and turns off the automatic page view", () => {
    track("login");
    const calls = gaCalls();
    expect(calls[0]).toEqual(["consent", "default", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied", wait_for_update: 500 }]);
    const config = calls.find((c) => c[0] === "config")!;
    expect(config[1]).toBe("G-TEST1234");
    expect(config[2]).toMatchObject({ send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
    expect(clarityCalls()[0]).toEqual(["consentv2", { ad_Storage: "denied", analytics_Storage: "denied" }]);
  });

  it("sends one event to both, with Clarity tags for each parameter", () => {
    track("invoice_push", { count: 4, ok_count: 3, failed_count: 1, outcome: "partial", location: "queue" });
    expect(gaCalls()).toContainEqual(["event", "invoice_push", { count: 4, ok_count: 3, failed_count: 1, outcome: "partial", location: "queue" }]);
    expect(clarityCalls()).toContainEqual(["event", "invoice_push"]);
    expect(clarityCalls()).toContainEqual(["set", "outcome", "partial"]);
    expect(clarityCalls()).toContainEqual(["set", "count", "4"]);
  });

  it("sets everything up once, however many events", () => {
    track("login");
    track("logout");
    expect(gaCalls().filter((c) => c[0] === "config")).toHaveLength(1);
    expect(clarityCalls().filter((c) => c[0] === "consentv2")).toHaveLength(1);
  });

  it("drops free text even when a caller passes it", () => {
    // A careless call: a supplier name and an email in parameters typed as slugs.
    track("connector_connect", { provider: "Al Noor Trading LLC" });
    track("settings_change", { setting: "member_invite", value: "someone@example.com" });
    expect(gaCalls()).toContainEqual(["event", "connector_connect", {}]);
    expect(gaCalls()).toContainEqual(["event", "settings_change", { setting: "member_invite" }]);
  });

  it("ignores event names that aren't in the catalogue", () => {
    track("supplier_name_seen" as never, {} as never);
    expect(gaCalls().some((c) => c[1] === "supplier_name_seen")).toBe(false);
  });

  it("starts from the visitor's stored choice, and updates both tools when it changes", () => {
    win.localStorage.setItem("sawwi-analytics-consent", "granted");
    track("login");
    expect(gaCalls()[0][2]).toMatchObject({ analytics_storage: "granted", ad_storage: "denied" });
    setConsent("denied");
    expect(gaCalls()).toContainEqual(["consent", "update", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied" }]);
    expect(clarityCalls()).toContainEqual(["consentv2", { ad_Storage: "denied", analytics_Storage: "denied" }]);
    expect(win.localStorage.getItem("sawwi-analytics-consent")).toBe("denied");
  });

  it("sends page views with the route, never the record or the query string", () => {
    trackPageView("/automation/purchase-invoices/3f2a9c1e-0b7d-4c55-9a51-1e2f3a4b5c6d");
    const view = gaCalls().find((c) => c[0] === "event" && c[1] === "page_view")!;
    expect(view[2]).toEqual({
      page_location: "https://sawwiapp.ai/automation/purchase-invoices/:id",
      page_path: "/automation/purchase-invoices/:id",
      page_title: "/automation/purchase-invoices/:id",
    });
    trackPageView("/runs/r_8x7");
    const set = gaCalls().filter((c) => c[0] === "set").at(-1)!;
    // The previous route is the referrer inside the app.
    expect(set[1]).toMatchObject({ page_path: "/runs/:id", page_referrer: "https://sawwiapp.ai/automation/purchase-invoices/:id" });
  });
});

describe("only GA4 or only Clarity", () => {
  it("sends to GA4 alone when Clarity has no ID", () => {
    vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "G-TEST1234");
    vi.stubEnv("NEXT_PUBLIC_CLARITY_PROJECT_ID", "");
    track("demo_start");
    expect(gaCalls()).toContainEqual(["event", "demo_start", {}]);
    expect(win.clarity).toBeUndefined();
  });

  it("sends to Clarity alone when GA4 has no ID", () => {
    vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "");
    vi.stubEnv("NEXT_PUBLIC_CLARITY_PROJECT_ID", "abc123xyz");
    track("demo_start");
    expect(win.dataLayer).toBeUndefined();
    expect(clarityCalls()).toContainEqual(["event", "demo_start"]);
  });
});

describe("on the server", () => {
  it("does nothing without a window", () => {
    vi.stubGlobal("window", undefined);
    vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "G-TEST1234");
    expect(() => track("login")).not.toThrow();
  });
});

describe("sanitizeParams", () => {
  it("keeps counts, flags and slugs, and drops text, emails, amounts and bad keys", () => {
    expect(
      sanitizeParams({
        count: 3,
        ok: true,
        template: "amazon-settlement",
        area: "/runs/:id",
        email: "a@b.co",
        supplier: "Desert Rose Trading",
        amount: "SAR 1,250.00",
        nan: Number.NaN,
        "Bad-Key": "x",
        long: "x".repeat(65),
      }),
    ).toEqual({ count: 3, ok: true, template: "amazon-settlement", area: "/runs/:id" });
  });

  it("the event list is complete", () => {
    expect(EVENT_NAMES_COMPLETE).toBe(true);
  });

  it("outcomeOf", () => {
    expect(outcomeOf(3, 3)).toBe("ok");
    expect(outcomeOf(0, 3)).toBe("failed");
    expect(outcomeOf(1, 3)).toBe("partial");
    expect(outcomeOf(0, 0)).toBe("failed");
  });
});

describe("normalizePath", () => {
  it.each([
    ["/home", "/home"],
    ["/runs/abc123", "/runs/:id"],
    ["/automation/cod/xyz", "/automation/cod/:id"],
    ["/automation/settlements/s1", "/automation/settlements/:id"],
    ["/automation/purchase-invoices", "/automation/purchase-invoices"],
    ["/templates/custom-1a2b3c4d", "/templates/:custom"],
    ["/templates/amazon-settlement", "/templates/amazon-settlement"],
    ["/reset-password?token=secret", "/reset-password"],
    ["/login?next=/runs/abc", "/login"],
    ["/checkout/growth", "/checkout/growth"],
    ["/x/123456/", "/x/:id"],
    ["/", "/"],
  ])("%s → %s", (raw, want) => expect(normalizePath(raw)).toBe(want));
});

describe("flash cookie", () => {
  it("round-trips known events and drops unknown names and unsafe values", () => {
    const raw = encodeURIComponent(JSON.stringify([["sign_up", { invited: false }], ["nope", {}], ["login", { email: "a@b.co" }]]));
    expect(parseFlash(raw)).toEqual([
      ["sign_up", { invited: false }],
      ["login", {}],
    ]);
    expect(parseFlash(encodeFlash([["logout", {}]]))).toEqual([["logout", {}]]);
    // As the browser sees it: encoded by Next's cookies().set.
    expect(parseFlash(encodeURIComponent(encodeFlash([["logout", {}]])))).toEqual([["logout", {}]]);
    expect(parseFlash("not json")).toEqual([]);
    expect(parseFlash(undefined)).toEqual([]);
  });
});
