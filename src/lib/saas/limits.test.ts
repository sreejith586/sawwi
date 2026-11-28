import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runAgent, type AgentEvent, type ModelCall } from "@/lib/agent/agent";
import * as invoices from "@/lib/automation/purchase-invoices/service";
import { getDb } from "@/lib/db";
import * as F from "@/lib/pdf/fixtures/make";
import { logUsage } from "@/lib/runs/store";
import { blockFor, dailyCapFor, planBlock } from "./limits";
import * as store from "./store";

// Plan limits against the database (D-99): a trial that has ended is on Free, and each Free limit
// is enforced on the server where the work happens.

const env = process.env as Record<string, string | undefined>;
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sawwi-limits-"));
  env.SAWWI_DATA_DIR = dir;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => store.setSetting("paywallEnabled", true));

const USAGE = { model: "claude-opus-5-5", inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 };
const at = new Date().toISOString();

/** A workspace whose 14-day trial ended yesterday. */
const endedTrial = (name: string) => store.createOrg(name, -1);
const addRuns = async (orgKey: string, n: number) => {
  for (let i = 0; i < n; i++) await getDb().run("INSERT INTO runs (id, org_key, template_id, status, created_at) VALUES (?, ?, ?, ?, ?)", randomUUID(), orgKey, "t", "collecting", at);
};
const addInvoices = async (orgKey: string, n: number) => {
  for (let i = 0; i < n; i++) {
    await getDb().run(
      "INSERT INTO purchase_invoices (id, org_key, file_name, file_hash, issuer_key, status, draft_json, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      randomUUID(), orgKey, `f${i}.pdf`, randomUUID(), "x", "needs_review", "{}", "{}", at, at,
    );
  }
};

describe("plan limits on the server (D-99)", () => {
  it("moves an ended trial to Free: 10 reconciliations a month, then a plain refusal", async () => {
    const org = await endedTrial("Ended Trial Co");
    expect(org.plan).toBe("trial");
    await addRuns(org.key, 9);
    expect(await blockFor(org, "run")).toBeUndefined();
    await addRuns(org.key, 1);
    expect(await blockFor(org, "run")).toEqual({ reason: "run_limit", message: expect.stringContaining("all 10 reconciliations on the Free plan") });
    // Work on runs already started, and reading, is never stopped by the monthly limit.
    expect(await blockFor(org, "work")).toBeUndefined();
  });

  it("enforces nothing while the paywall is off", async () => {
    const org = await endedTrial("Early Access Co");
    await addRuns(org.key, 20);
    await store.setSetting("paywallEnabled", false);
    expect(await blockFor(org, "run")).toBeUndefined();
    expect(await blockFor(org, "schedule")).toBeUndefined();
  });

  it("keeps a trial that's still running on the trial's limits", async () => {
    const org = await store.createOrg("Fresh Trial Co", 14);
    await addRuns(org.key, 12);
    expect(await blockFor(org, "run")).toBeUndefined();
    expect(await blockFor(org, "schedule")).toBeUndefined();
  });

  it("refuses the 26th purchase invoice of the month at capture", async () => {
    const org = await endedTrial("Invoice Co");
    await addInvoices(org.key, 25);
    expect(await planBlock(org.key, "invoice")).toMatchObject({ reason: "invoice_limit" });
    await expect(invoices.capturePdf(org.key, "u1", { name: "new.pdf", bytes: await F.longScanPdf(1) }, { ai: null })).rejects.toThrow(/all 25 purchase invoices on the Free plan/);
  });

  it("caps AI invoice readings at Free's daily allowance, below the platform cap", async () => {
    const org = await endedTrial("AI Co");
    for (let i = 0; i < 10; i++) await logUsage(null, "invoice_extraction", USAGE, org.key);
    expect(await dailyCapFor(org.key, "aiReadsPerDay", 200)).toBe(10);
    let calls = 0;
    const ai = async () => {
      calls++;
      throw new Error("must not be called");
    };
    const { capture } = await invoices.capturePdf(org.key, "u1", { name: "scan.pdf", bytes: await F.longScanPdf(2) }, { ai });
    expect(calls).toBe(0);
    expect(capture.failure?.message).toMatch(/10 AI invoice readings on the Free plan/);
  });

  it("stops Ask Sawwi at Free's daily allowance before any model call", async () => {
    const org = await endedTrial("Agent Co");
    for (let i = 0; i < 25; i++) await logUsage(null, "agent_chat", USAGE, org.key);
    const model = (async () => {
      throw new Error("must not be called");
    }) as unknown as ModelCall;
    const events: AgentEvent[] = [];
    await runAgent({ orgKey: org.key, userId: "u1", canEdit: true, aiAvailable: true }, [], "Hello", (e) => events.push(e), model);
    expect(events).toEqual([{ type: "error", message: expect.stringContaining("25 assistant calls on the Free plan") }]);
  });

  it("counts connections, and leaves schedules out, on Free", async () => {
    const org = await endedTrial("Connector Co");
    expect(await blockFor(org, "connector")).toBeUndefined();
    await getDb().run("INSERT INTO connections (id, org_key, provider, account_label, secret_enc, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", randomUUID(), org.key, "shopify", "shop", "x", "ok", at);
    expect(await blockFor(org, "connector")).toMatchObject({ reason: "connector_limit" });
    expect(await blockFor(org, "schedule")).toMatchObject({ reason: "schedule_limit" });
  });

  it("leaves a paid plan's limits as they were", async () => {
    const org = await endedTrial("Paid Co");
    await store.setOrgPlan(org.id, "growth");
    const paid = (await store.getOrg(org.id))!;
    await addRuns(paid.key, 20);
    await addInvoices(paid.key, 30);
    for (const action of ["run", "invoice", "connector", "schedule", "ai_read", "agent_call"] as const) expect(await blockFor(paid, action)).toBeUndefined();
  });
});
