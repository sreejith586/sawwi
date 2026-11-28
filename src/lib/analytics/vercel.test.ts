import { describe, expect, it } from "vitest";
import { vercelBeforeSend } from "./vercel";

describe("Vercel Web Analytics URLs (D-98)", () => {
  it("sends the route, never a record, a token or a query", () => {
    const send = (url: string) => vercelBeforeSend({ type: "pageview", url })?.url;
    expect(send("https://sawwiapp.ai/automation/purchase-invoices/3f2b9c1e-1a2b-4c3d-8e9f-001122334455")).toBe("https://sawwiapp.ai/automation/purchase-invoices/:id");
    expect(send("https://sawwiapp.ai/reset-password?token=secret-value#x")).toBe("https://sawwiapp.ai/reset-password");
    expect(send("https://sawwiapp.ai/settings/connections?connected=Acme%20Trading")).toBe("https://sawwiapp.ai/settings/connections");
    expect(send("https://sawwiapp.ai/")).toBe("https://sawwiapp.ai/");
  });

  it("keeps the event type and drops anything that isn't a URL", () => {
    expect(vercelBeforeSend({ type: "event", url: "https://sawwiapp.ai/runs/42?x=1" })).toEqual({ type: "event", url: "https://sawwiapp.ai/runs/:id" });
    expect(vercelBeforeSend({ type: "pageview", url: "not a url" })).toBeNull();
  });
});
