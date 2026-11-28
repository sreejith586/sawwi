import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetDemoErpWrites } from "@/lib/connectors/mock";
import { DEMO_ORG_KEY } from "@/lib/demo/demo";
import * as invoices from "@/lib/automation/purchase-invoices/service";
import { logUsage } from "@/lib/runs/store";
import { decide } from "./actions";
import { runAgent, type AgentEvent, type ModelCall } from "./agent";
import { runTool, type ToolContext } from "./tools";

// The chat agent (D-96), with a scripted model: no test calls the API.

const env = process.env as Record<string, string | undefined>;
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sawwi-agent-"));
  env.SAWWI_DATA_DIR = dir;
  resetDemoErpWrites();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ORG = DEMO_ORG_KEY;
const ctx: ToolContext = { orgKey: ORG, userId: "u-agent", canEdit: true, aiAvailable: false };

/** A model that plays back the given replies in order and records what it was sent. */
function scripted(replies: Partial<Anthropic.Beta.BetaMessage>[]): ModelCall & { seen: Anthropic.Beta.BetaMessageParam[][] } {
  const seen: Anthropic.Beta.BetaMessageParam[][] = [];
  const f = async (req: { messages: Anthropic.Beta.BetaMessageParam[] }) => {
    seen.push(JSON.parse(JSON.stringify(req.messages)));
    const r = replies.shift();
    if (!r) throw new Error("no more replies");
    return { id: "msg", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 }, ...r } as Anthropic.Beta.BetaMessage;
  };
  return Object.assign(f, { seen }) as unknown as ModelCall & { seen: Anthropic.Beta.BetaMessageParam[][] };
}
const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({ type: "tool_use", id, name, input }) as Anthropic.Beta.BetaToolUseBlock;
const text = (t: string) => ({ type: "text", text: t, citations: null }) as Anthropic.Beta.BetaTextBlock;

describe("chat agent (D-96)", () => {
  it("looks things up with tools, streams each step, and returns the conversation append-only", async () => {
    await invoices.captureSample(ORG, "u-agent", "gulf-lighting-gls-2360", { countries: ["AE"] });
    const thinking = { type: "thinking", thinking: "", signature: "sig-1" } as Anthropic.Beta.BetaThinkingBlock;
    const model = scripted([
      { stop_reason: "tool_use", content: [thinking, toolUse("t1", "list_invoices", { status: "to_review" })] },
      { content: [text("GLS-2360 is ready: its PO-7002 match is confirmed.")] },
    ]);
    const events: AgentEvent[] = [];
    await runAgent(ctx, [], "What needs my attention?", (e) => events.push(e), model);
    expect(events.map((e) => e.type)).toEqual(["step", "text", "done"]);
    expect(events[0]).toMatchObject({ tool: "list_invoices", summary: "Listed 1 invoice", ok: true });
    const done = events.at(-1) as Extract<AgentEvent, { type: "done" }>;
    // The thinking block goes back unchanged, then the tool result, then the answer.
    expect(done.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect((done.messages[1].content as unknown[])[0]).toEqual(thinking);
    const result = JSON.parse(((done.messages[2].content as Anthropic.Beta.BetaToolResultBlockParam[])[0].content as string));
    expect(result.invoices[0]).toMatchObject({ number: "GLS-2360", po: ["PO-7002"], grn: ["PRC-8002"], status: "ready" });
    // The second call saw the first turn exactly as it was returned.
    expect(model.seen[1].slice(0, 2)).toEqual(done.messages.slice(0, 2));
  });

  it("proposes approvals for the user to confirm; only the proposer can, once", async () => {
    const out = await runTool(ctx, "propose_action", { action: "approve", invoices: ["GLS-2360"] });
    expect(out.proposal).toMatchObject({ kind: "approve", status: "pending", invoices: [{ label: expect.stringContaining("GLS-2360") }] });
    const [v] = (await invoices.listViews(ORG)).filter((x) => x.draft.invoiceNumber === "GLS-2360");
    expect(v.status).toBe("ready"); // nothing ran yet
    await expect(decide(ORG, "someone-else", out.proposal!.id, "confirm")).rejects.toThrow(/Only the person who asked/);
    const done = await decide(ORG, "u-agent", out.proposal!.id, "confirm");
    expect(done).toMatchObject({ status: "done", results: [{ ok: true }] });
    expect((await invoices.getView(ORG, v.id))!.status).toBe("approved");
    expect((await decide(ORG, "u-agent", out.proposal!.id, "confirm")).status).toBe("done");
  });

  it("approves with a suggested PO/GRN match confirmed on the same card", async () => {
    const { capture } = await invoices.captureSample(ORG, "u-agent", "gulf-lighting-gls-2307", { countries: ["AE"] });
    // No PO printed: PO-7002 is suggested and not confirmed yet, which alone blocks approval on the page.
    expect(capture.draft).toMatchObject({ postTo: "order" });
    expect(capture.draft.poConfirmed).toBeUndefined();
    const out = await runTool(ctx, "propose_action", { action: "approve", invoices: ["GLS-2307"] });
    expect(out.proposal!.invoices[0]).toMatchObject({ note: "Also confirms the match to PO-7002" });
    const done = await decide(ORG, "u-agent", out.proposal!.id, "confirm");
    expect(done.results).toEqual([{ label: expect.stringContaining("GLS-2307"), ok: true, message: "Approved." }]);
    const v = (await invoices.getView(ORG, capture.id))!;
    expect(v).toMatchObject({ status: "approved", draft: { poConfirmed: true } });
  });

  it("refuses a proposal an invoice can't take, and a push of an invoice changed since it was proposed", async () => {
    await expect(runTool(ctx, "propose_action", { action: "push", invoices: ["NOPE-1"] })).rejects.toThrow(/No invoice "NOPE-1"/);
    const push = await runTool(ctx, "propose_action", { action: "push", invoices: ["GLS-2360"] });
    // An edit after the proposal withdraws the approval and changes the content: the push is refused.
    await runTool(ctx, "set_post_to", { invoice: "GLS-2360", post_to: "invoice" });
    const done = await decide(ORG, "u-agent", push.proposal!.id, "confirm");
    expect(done.results![0]).toMatchObject({ ok: false, message: expect.stringMatching(/isn't approved as it stands/) });
  });

  it("gives viewers the read tools only", async () => {
    const viewer = { ...ctx, canEdit: false };
    expect((await runTool(viewer, "set_post_to", { invoice: "GLS-2360", post_to: "order" })).result).toMatchObject({ error: expect.stringContaining("viewer") });
    expect((await runTool(viewer, "propose_action", { action: "approve", invoices: ["GLS-2360"] })).result).toMatchObject({ error: expect.stringContaining("viewer") });
    expect((await runTool(viewer, "get_invoice", { invoice: "GLS-2360" })).result).toMatchObject({ number: "GLS-2360" });
  });

  it("stops at the workspace's daily cap of model calls", async () => {
    env.SAWWI_AGENT_CALLS_PER_DAY = "1";
    try {
      await logUsage(null, "agent_chat", { model: "claude-opus-5-5", inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 }, ORG);
      const events: AgentEvent[] = [];
      await runAgent(ctx, [], "Hello", (e) => events.push(e), scripted([]));
      expect(events).toEqual([{ type: "error", message: expect.stringContaining("used its 1 assistant calls") }]);
    } finally {
      delete env.SAWWI_AGENT_CALLS_PER_DAY;
    }
  });
});
