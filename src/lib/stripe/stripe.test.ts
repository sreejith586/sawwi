import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { planForPrice, planFromSubscription, priceIdFor } from "./plans";

const env = { STRIPE_PRICE_STARTER: "price_starter", STRIPE_PRICE_GROWTH: "price_growth" };

describe("Stripe price ↔ plan", () => {
  it("maps configured prices both ways", () => {
    expect(priceIdFor("starter", env)).toBe("price_starter");
    expect(priceIdFor("enterprise", env)).toBeUndefined();
    expect(planForPrice("price_growth", env)).toBe("growth");
    expect(planForPrice("price_unknown", env)).toBeUndefined();
  });

  it("keeps the paid plan while active, trialing or retrying payment", () => {
    for (const status of ["active", "trialing", "past_due"]) expect(planFromSubscription(status, "price_growth", env)).toBe("growth");
  });

  it("drops back to trial once the subscription stops", () => {
    for (const status of ["canceled", "unpaid", "incomplete_expired", "paused", "incomplete"]) {
      expect(planFromSubscription(status, "price_growth", env)).toBe("trial");
    }
    expect(planFromSubscription("active", "price_unknown", env)).toBe("trial");
  });
});

describe("webhook route", () => {
  afterEach(() => vi.unstubAllEnvs());

  const post = async (body: string, signature?: string) => {
    vi.resetModules();
    const { POST } = await import("@/app/api/stripe/webhook/route");
    return POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body, headers: signature ? { "stripe-signature": signature } : {} }));
  };

  it("refuses when Stripe isn't configured", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect((await post("{}", "t=1,v1=x")).status).toBe(503);
  });

  it("rejects bad or missing signatures and accepts a correctly signed event", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_secret");
    const payload = JSON.stringify({ id: "evt_1", object: "event", type: "customer.created", data: { object: {} } });

    expect((await post(payload)).status).toBe(400);
    expect((await post(payload, "t=1,v1=forged")).status).toBe(400);

    const header = new Stripe("sk_test_dummy").webhooks.generateTestHeaderString({ payload, secret: "whsec_test_secret" });
    const ok = await post(payload, header);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ received: true });
  });
});
