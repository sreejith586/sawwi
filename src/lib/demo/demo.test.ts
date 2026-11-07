import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fillRunWithDemoData } from "@/lib/connectors/demo-fill";
import { llmAvailable } from "@/lib/mapping/llm";
import * as runStore from "@/lib/runs/store";
import * as saas from "@/lib/saas/store";
import { DEMO_ORG_KEY, DEMO_USER_EMAIL, isDemoOrg, needsReset, nextResetAt, resetBoundary, untilNextReset } from "./demo";
import { ensureDemoWorkspace, lastDemoReset, resetDemoIfDue } from "./workspace";

// The public demo store (D-32): created on first use, editor-only, never calls the AI, and wiped
// once a day at 00:00 UTC without touching any other workspace.

const env = process.env as Record<string, string | undefined>;
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sawwi-demo-store-"));
  env.SAWWI_DATA_DIR = dir;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const at = (iso: string) => Date.parse(iso);

describe("daily reset timing", () => {
  it("resets on the first use after 00:00 UTC", () => {
    expect(resetBoundary(at("2026-11-07T15:30:00Z"))).toBe(at("2026-11-07T00:00:00Z"));
    expect(nextResetAt(at("2026-11-07T15:30:00Z"))).toBe(at("2026-11-08T00:00:00Z"));
    expect(needsReset(undefined, at("2026-11-07T15:30:00Z"))).toBe(true);
    expect(needsReset(at("2026-11-07T00:00:01Z"), at("2026-11-07T23:59:59Z"))).toBe(false);
    expect(needsReset(at("2026-11-06T23:59:59Z"), at("2026-11-07T00:00:00Z"))).toBe(true);
    expect(untilNextReset(at("2026-11-07T18:40:00Z"))).toBe("5 h 20 min");
    expect(untilNextReset(at("2026-11-07T23:59:30Z"))).toBe("1 min");
  });

  it("uses a key no real workspace can get", () => {
    const real = saas.createOrg("Sawwi Demo", 14);
    expect(real.key).toBe("sawwi-demo");
    expect(isDemoOrg(real.key)).toBe(false);
    expect(isDemoOrg(DEMO_ORG_KEY)).toBe(true);
  });
});

describe("demo workspace", () => {
  it("is created once, on an unlimited plan, with a shared editor who can't log in", async () => {
    const a = await ensureDemoWorkspace();
    const b = await ensureDemoWorkspace();
    expect(a.org.id).toBe(b.org.id);
    expect(a.org).toMatchObject({ key: DEMO_ORG_KEY, plan: "enterprise", status: "active" });
    expect(a.org.profile?.channels).toEqual(["marketplace", "webstore", "b2b"]);
    expect(a.user.email).toBe(DEMO_USER_EMAIL);
    expect(saas.getMembership(a.org.id, a.user.id)?.access).toBe("editor");
  });

  it("never calls the AI, even with a key", () => {
    env.ANTHROPIC_API_KEY = "sk-ant-test-not-used";
    try {
      expect(llmAvailable("acme")).toBe(true);
      expect(llmAvailable(DEMO_ORG_KEY)).toBe(false);
    } finally {
      delete env.ANTHROPIC_API_KEY;
    }
  });

  it("wipes only the demo's data, once a day", async () => {
    const { org, user } = await ensureDemoWorkspace();
    resetDemoIfDue(at("2026-11-07T00:00:05Z")); // start from a clean slate for this test
    const demoRun = runStore.createRun(DEMO_ORG_KEY, "web-orders-vs-gateway");
    await fillRunWithDemoData(demoRun, { countries: ["AE"] });
    const uploads = path.join(dir, "uploads", demoRun.id);
    mkdirSync(uploads, { recursive: true });
    writeFileSync(path.join(uploads, "x.csv"), "a,b\n");
    const realRun = runStore.createRun("acme", "web-orders-vs-gateway");

    expect(resetDemoIfDue(at("2026-11-07T22:00:00Z"))).toBe(false); // same day: nothing happens
    expect(runStore.getRun(demoRun.id)).toBeDefined();

    expect(resetDemoIfDue(at("2026-11-08T00:01:00Z"))).toBe(true); // first use after midnight UTC
    expect(lastDemoReset()).toBe("2026-11-08T00:01:00.000Z");
    expect(runStore.getRun(demoRun.id)).toBeUndefined();
    expect(runStore.getRunFiles(demoRun.id)).toEqual([]);
    expect(existsSync(uploads)).toBe(false);
    expect(runStore.getRun(realRun.id)).toBeDefined(); // other workspaces untouched
    // The workspace and its visitor survive, so open sessions keep working.
    expect(saas.getOrgByKey(DEMO_ORG_KEY)?.id).toBe(org.id);
    expect(saas.getMembership(org.id, user.id)?.access).toBe("editor");
  });
});
