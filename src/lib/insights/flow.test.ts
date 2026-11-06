import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { answerQuestion, ingestFile } from "@/lib/runs/engine";
import { runReconciliation } from "@/lib/runs/reconcile";
import * as store from "@/lib/runs/store";
import { GENERIC_SETUP_KEY, saveRunAsTemplate, templateForRun } from "@/lib/runs/templates";
import { buildRunView } from "@/lib/runs/view";
import { GENERIC_TEMPLATE_ID } from "@/lib/templates/custom";
import { chat, ChatInputError, narrativeFor } from "./chat";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sawwi-insights-"));
  process.env.SAWWI_DATA_DIR = dir;
  // Rules only: these tests must never call the API.
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const csv = (rows: string[][]) => new TextEncoder().encode(rows.map((r) => r.join(",")).join("\n"));
const ledger = csv([
  ["Doc No", "Posting Date", "Party", "Debit"],
  ["INV-1", "2026-09-03", "Noon", "100.00"],
  ["INV-2", "2026-09-10", "Amazon", "250.00"],
  ["INV-3", "2026-10-02", "Noon", "80.00"],
]);
const bank = csv([
  ["Txn Ref", "Value Date", "Narrative", "Credit Amt"],
  ["INV-1", "2026-09-04", "NOON PAYOUT", "100.00"],
  ["INV-2", "2026-09-12", "AMZ PAYOUT", "245.50"],
  ["INV-7", "2026-10-07", "UNKNOWN", "75.00"],
]);
const ctx = { countries: ["AE" as const] };

/** Answers chips the way a user would: confirm a right guess, reject a wrong one, pick from the list. */
function answerAll(runId: string, columns: string[]) {
  for (let i = 0; i < 20; i++) {
    const q = buildRunView(runId)!.openQuestions[0];
    if (!q) return;
    const yesNo = q.options.some((o) => o.value === "yes");
    const value = yesNo
      ? columns.some((c) => q.prompt.includes(`"${c}"`)) || !q.prompt.startsWith("In your")
        ? "yes"
        : "no"
      : (q.options.find((o) => columns.includes(o.value)) ?? q.options[0]).value;
    answerQuestion(store.getRun(runId)!, q.id, value);
  }
}

describe("custom reconciliation, chat and save-as-template", () => {
  it("runs end to end without AI and remembers the setup", async () => {
    const run = store.createRun("acme", GENERIC_TEMPLATE_ID);
    store.setRunCheck(run.id, GENERIC_SETUP_KEY, { leftLabel: "Ledger", rightLabel: "Bank", tolerance: 0.01 });
    expect(templateForRun(run)!.title).toBe("Ledger vs Bank");

    await ingestFile(run, "left", "ledger.csv", ledger, ctx);
    await ingestFile(run, "right", "bank.csv", bank, ctx);

    // Key and amount are always confirmed with chips, never guessed silently.
    const kinds = buildRunView(run.id)!.openQuestions.length;
    expect(kinds).toBeGreaterThanOrEqual(4);
    answerAll(run.id, ["Doc No", "Debit", "Txn Ref", "Credit Amt"]);
    let view = buildRunView(run.id)!;
    expect(view.status).toBe("ready");
    const left = Object.fromEntries(view.slots[0].file!.fields.map((f) => [f.key, f.column]));
    const right = Object.fromEntries(view.slots[1].file!.fields.map((f) => [f.key, f.column]));
    expect([left.reference, left.amount, right.reference, right.amount]).toEqual(["Doc No", "Debit", "Txn Ref", "Credit Amt"]);

    runReconciliation(store.getRun(run.id)!, ["AE"]);
    view = buildRunView(run.id)!;
    expect(view.report!.totals.exceptions).toBe(3); // INV-3 missing, INV-7 unknown, INV-2 short
    expect(view.insights!.ai).toBe(false);
    expect(view.insights!.checks[0].dims.map((d) => d.key)).toContain("month");
    expect(view.generic?.leftLabel).toBe("Ledger");

    // Narrative falls back to the rule summary and isn't cached, so a key added later still writes one.
    const n = await narrativeFor(store.getRun(run.id)!, true);
    expect(n!.source).toBe("rules");
    expect(n!.narrative.headline).toMatch(/^Done\./);
    expect(store.getNarrative(run.id, store.getResult(run.id)!.createdAt)).toBeUndefined();

    // One-click follow-ups, all answered by code.
    const r = store.getRun(run.id)!;
    await chat(r, { kind: "fix_first" }, "Acme");
    await chat(r, { kind: "breakdown", check: "missing_right", by: "month" }, "Acme");
    await chat(r, { kind: "email", check: "amount_mismatch" }, "Acme");
    await chat(r, { kind: "explain", exception: 0 }, "Acme");
    await chat(r, { kind: "ask", text: "Why is INV-2 short?" }, "Acme");
    const msgs = store.getMessages(run.id).filter((m) => m.payload);
    expect(msgs.filter((m) => m.role === "user")).toHaveLength(5);
    const types = msgs.filter((m) => m.role === "sawwi").map((m) => m.payload!.type);
    expect(types).toEqual(["fix_first", "breakdown", "email", "answer", "answer"]);
    const email = msgs.find((m) => m.payload?.type === "email")!.payload!;
    expect(email.type === "email" && email.body).toContain("INV-2");
    expect(email.type === "email" && email.body).toContain("Acme");
    const bd = msgs.find((m) => m.payload?.type === "breakdown")!.payload!;
    expect(bd.type === "breakdown" && bd.rows).toEqual([{ group: "2026-10", count: 1, value: 80 }]);
    expect(store.getUsage(run.id).calls).toBe(0);

    await expect(chat(r, { kind: "breakdown", check: "missing_right", by: "nope" }, "Acme")).rejects.toBeInstanceOf(ChatInputError);
    await expect(chat(r, { kind: "email", check: "duplicate_right" }, "Acme")).rejects.toBeInstanceOf(ChatInputError);

    // Save as template: listed for this workspace only, and the next run asks nothing.
    const saved = saveRunAsTemplate(r, "Bank rec");
    expect(store.listCustomTemplates("acme").map((t) => t.title)).toEqual(["Bank rec"]);
    expect(store.listCustomTemplates("someone-else")).toEqual([]);

    const run2 = store.createRun("acme", saved.id);
    await ingestFile(run2, "left", "ledger-oct.csv", ledger, ctx);
    await ingestFile(run2, "right", "bank-oct.csv", bank, ctx);
    const view2 = buildRunView(run2.id)!;
    expect(view2.templateTitle).toBe("Bank rec");
    expect(view2.custom).toBe(true);
    expect(view2.openQuestions).toEqual([]);
    expect(view2.status).toBe("ready");
  });

  it("proposes an identifier column as the key, not free-text narration", async () => {
    const run = store.createRun("key-guess-co", GENERIC_TEMPLATE_ID);
    await ingestFile(run, "left", "bank.csv", bank, ctx);
    const keyQuestions = store
      .getQuestions(run.id)
      .map((q) => q.payload)
      .filter((p) => (p.kind === "confirm_column" || p.kind === "choose_column") && p.field === "reference");
    expect(keyQuestions).toHaveLength(1);
    const q = keyQuestions[0];
    expect(q.kind).toBe("confirm_column");
    expect(q.kind === "confirm_column" && q.column).toBe("Txn Ref");
  });

  it("never proposes a free-text column as the key, even when its header looks like a key alias", async () => {
    // "Narrative" is close to "narration", a known alias of "reference" (catalogue bank templates read invoice numbers out of it).
    const statement = csv([
      ["Narrative", "Bank Ref", "Value Date", "Amount"],
      ["NOON PAYOUT OCT", "FT26100201", "2026-10-02", "1200.00"],
      ["AMAZON SETTLEMENT", "FT26100502", "2026-10-05", "845.50"],
      ["TABBY TRANSFER", "FT26100903", "2026-10-09", "300.00"],
      ["UNKNOWN CREDIT", "FT26102104", "2026-10-21", "75.00"],
    ]);
    const run = store.createRun("key-guess-co", GENERIC_TEMPLATE_ID);
    await ingestFile(run, "left", "statement.csv", statement, ctx);
    const q = store
      .getQuestions(run.id)
      .map((x) => x.payload)
      .find((p) => (p.kind === "confirm_column" || p.kind === "choose_column") && p.field === "reference")!;
    if (q.kind === "confirm_column") expect(q.column).toBe("Bank Ref");
    else expect(q.kind === "choose_column" && q.options[0]).toBe("Bank Ref");
  });

  it("never offers a column that a later answer has already taken", async () => {
    const run = store.createRun("stale-chip-co", GENERIC_TEMPLATE_ID);
    await ingestFile(run, "left", "bank.csv", bank, ctx);
    const open = () => store.getQuestions(run.id).filter((q) => q.answer === null);
    const find = (kind: string, field: string) => open().find((q) => q.payload.kind === kind && "field" in q.payload && q.payload.field === field)!;
    const shown = (id: string) => buildRunView(run.id)!.openQuestions.find((q) => q.id === id)!.options.map((o) => o.value);

    // Reject the key guess while the amount is still unconfirmed: the follow-up lists Credit Amt.
    answerQuestion(store.getRun(run.id)!, find("confirm_column", "reference").id, "no");
    const chooseKey = find("choose_column", "reference");
    expect(chooseKey.payload.kind === "choose_column" && chooseKey.payload.options).toContain("Credit Amt");

    // Credit Amt becomes the amount: the key chips no longer offer it, and picking it is refused.
    answerQuestion(store.getRun(run.id)!, find("confirm_column", "amount").id, "yes");
    expect(shown(chooseKey.id)).not.toContain("Credit Amt");
    expect(shown(chooseKey.id)).toContain("Narrative");
    expect(() => answerQuestion(store.getRun(run.id)!, chooseKey.id, "Credit Amt")).toThrow(/offered answers/);
  });

  it("turns an open 'Is X the key?' into a fresh choice once X is taken", async () => {
    const run = store.createRun("stale-chip-co", GENERIC_TEMPLATE_ID);
    await ingestFile(run, "left", "bank.csv", bank, ctx);
    const open = () => store.getQuestions(run.id).filter((q) => q.answer === null);
    const find = (kind: string, field: string) => open().find((q) => q.payload.kind === kind && "field" in q.payload && q.payload.field === field);

    expect(find("confirm_column", "amount")?.payload).toMatchObject({ column: "Credit Amt" });
    // Reject the key guess and (oddly) pick Credit Amt as the key while "Is Credit Amt the amount?" is open.
    answerQuestion(store.getRun(run.id)!, find("confirm_column", "reference")!.id, "no");
    answerQuestion(store.getRun(run.id)!, find("choose_column", "reference")!.id, "Credit Amt");

    expect(find("confirm_column", "amount")).toBeUndefined();
    const chooseAmount = find("choose_column", "amount")!;
    expect(chooseAmount.payload.kind === "choose_column" && chooseAmount.payload.options).not.toContain("Credit Amt");
    expect(open().filter((q) => "field" in q.payload && q.payload.field === "amount")).toHaveLength(1);
  });

  it("refuses chat before there is a result", async () => {
    const run = store.createRun("acme", GENERIC_TEMPLATE_ID);
    await expect(chat(run, { kind: "fix_first" }, "Acme")).rejects.toBeInstanceOf(ChatInputError);
  });
});
