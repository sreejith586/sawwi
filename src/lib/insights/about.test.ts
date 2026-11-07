import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as store from "@/lib/runs/store";
import { getTemplate } from "@/lib/templates/catalog";
import { ABOUT_QUESTIONS, aboutAnswer } from "./about";
import { chat } from "./chat";

// Canned questions for a fresh chat (D-35): answered from the template by rules, before any file.

const env = process.env as Record<string, string | undefined>;
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sawwi-about-"));
  env.SAWWI_DATA_DIR = dir;
  delete env.ANTHROPIC_API_KEY;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("canned answers", () => {
  const t = getTemplate("p2p-three-way-match")!;

  it("lists the files with what each must contain", () => {
    const a = aboutAnswer(t, "files");
    expect(a).toMatch(/^This reconciliation uses 3 files:/);
    expect(a).toContain("• Purchase order lines:");
    expect(a).toContain("It needs po number, qty ordered, po unit price (excl. vat).");
  });

  it("lists automatic and manual checks", () => {
    const a = aboutAnswer(t, "checks");
    expect(a).toMatch(/^I run \d+ checks on every match:/);
    for (const c of t.checks.filter((x) => x.rule)) expect(a).toContain(`• ${c.label}:`);
  });

  it("explains each link with its keys and tolerances, and that matching is not AI", () => {
    const a = aboutAnswer(t, "matching");
    expect(a).toContain("Purchase order lines ↔ Goods received notes (GRN): rows match on PO number = PO number and SKU = SKU.");
    expect(a).toContain("never by AI");
    const settlement = aboutAnswer(getTemplate("mkt-settlement-vs-sales")!, "matching");
    expect(settlement).toContain("Amounts must agree within 0.5. Dates may be up to 45 days apart.");
    expect(aboutAnswer(getTemplate("mkt-ads-deductions")!, "matching")).toContain("rows match on the same month");
  });

  it("names typical exports per file", () => {
    expect(aboutAnswer(t, "exports")).toContain("• Goods received notes (GRN): ERP goods receipt / GRN lines");
  });
});

describe("asking a canned question in a run", () => {
  it("works before any file is uploaded, with no AI", async () => {
    const run = await store.createRun("acme", "web-orders-vs-gateway");
    for (const q of ABOUT_QUESTIONS) await chat(run, { kind: "about", topic: q.topic }, "Acme");
    const messages = await store.getMessages(run.id);
    expect(messages.map((m) => m.role)).toEqual(["user", "sawwi", "user", "sawwi", "user", "sawwi", "user", "sawwi"]);
    expect(messages[0]).toMatchObject({ body: "What files do I need?", payload: { type: "question" } });
    expect(messages[1].payload).toEqual({ type: "answer", source: "rules" });
    expect((await store.getUsage(run.id)).calls).toBe(0);
  });

  it("refuses an unknown topic", async () => {
    const run = await store.createRun("acme", "web-bnpl");
    await expect(chat(run, { kind: "about", topic: "nonsense" as never }, "Acme")).rejects.toThrow(/suggested questions/);
  });
});
