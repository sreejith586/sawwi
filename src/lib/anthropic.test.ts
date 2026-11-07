import { afterEach, describe, expect, it } from "vitest";
import { anthropicClient } from "./anthropic";

// Sends one request through a fake fetch and returns the headers it went out with.
async function sentHeaders(): Promise<Headers> {
  let seen = new Headers();
  const client = anthropicClient({
    apiKey: "sk-ant-test-not-used",
    maxRetries: 0,
    fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
      seen = new Headers(init?.headers);
      return new Response(JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  await client.models.list();
  return seen;
}

describe("anthropicClient", () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_WORKSPACE_ID;
  });

  it("sends no workspace header by default", async () => {
    expect((await sentHeaders()).get("anthropic-workspace-id")).toBeNull();
  });

  it("names the workspace when ANTHROPIC_WORKSPACE_ID is set", async () => {
    process.env.ANTHROPIC_WORKSPACE_ID = " wrkspc_123 ";
    expect((await sentHeaders()).get("anthropic-workspace-id")).toBe("wrkspc_123");
  });
});
