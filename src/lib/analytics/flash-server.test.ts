import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, { value: string; options?: Record<string, unknown> }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) => void jar.set(name, { value, options }),
  }),
}));

const { flashEvent } = await import("./flash-server");
const { FLASH_COOKIE, parseFlash } = await import("./flash");

beforeEach(() => jar.clear());
afterEach(() => vi.unstubAllEnvs());

describe("flashEvent", () => {
  it("sets no cookie when analytics is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "");
    vi.stubEnv("NEXT_PUBLIC_CLARITY_PROJECT_ID", "");
    await flashEvent("login");
    expect(jar.size).toBe(0);
  });

  it("queues events for the next page in a short-lived cookie", async () => {
    vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "G-TEST1234");
    await flashEvent("sign_up", { invited: true });
    await flashEvent("onboarding_complete", { channel_count: 2, marketplace: true, webstore: true, b2b: false });
    const cookie = jar.get(FLASH_COOKIE)!;
    expect(parseFlash(cookie.value)).toEqual([
      ["sign_up", { invited: true }],
      ["onboarding_complete", { channel_count: 2, marketplace: true, webstore: true, b2b: false }],
    ]);
    expect(cookie.options).toMatchObject({ path: "/", maxAge: 60, sameSite: "lax", httpOnly: false });
  });
});
