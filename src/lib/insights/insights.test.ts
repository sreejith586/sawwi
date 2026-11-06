import { describe, expect, it } from "vitest";
import { parseNumber } from "@/lib/files/profile";
import { parseDate, type Dataset, type Rec } from "@/lib/recon/load";
import { reconcile } from "@/lib/recon/match";
import { cleanLabel, genericTemplate, parseTolerance } from "@/lib/templates/custom";
import type { Template } from "@/lib/templates/types";
import {
  BLANK,
  breakdown,
  breakdownOptions,
  describeBreakdown,
  digestText,
  emailFacts,
  exceptionFacts,
  fixFirst,
  ruleEmail,
  ruleExplanation,
  ruleNarrative,
} from "./facts";
import { INSTRUCTIONS } from "./llm";

// A generic bank-vs-ledger reco with known differences, run through the real engine.
const template = genericTemplate({ leftLabel: "Ledger", rightLabel: "Bank", tolerance: 0.01 });

function ds(t: Template, slotKey: string, rows: Record<string, string>[]): [string, Dataset] {
  const slot = t.sources.find((s) => s.key === slotKey)!;
  const recs: Rec[] = rows.map((row, i) => {
    const rec: Rec = { slot: slotKey, rowNumber: i + 2, raw: {}, num: {}, date: {} };
    for (const f of slot.fields) {
      if (!(f.key in row)) continue;
      rec.raw[f.key] = row[f.key];
      if (f.type === "money") rec.num[f.key] = parseNumber(row[f.key]);
      if (f.type === "date") rec.date[f.key] = parseDate(row[f.key], "ISO");
    }
    return rec;
  });
  return [slotKey, { slot, fileName: `${slotKey}.csv`, rows: recs }];
}

const ledger = [
  { reference: "INV-1", amount: "100.00", date: "2026-09-03", description: "Noon" },
  { reference: "INV-2", amount: "250.00", date: "2026-09-10", description: "Amazon" },
  { reference: "INV-3", amount: "80.00", date: "2026-10-02", description: "Noon" },
  { reference: "INV-4", amount: "500.00", date: "2026-10-05", description: "Noon" },
  { reference: "INV-5", amount: "40.00", date: "2026-10-06", description: "Amazon" },
  { reference: "INV-5", amount: "40.00", date: "2026-10-06", description: "Amazon" },
];
const bank = [
  { reference: "inv-1", amount: "100.00", date: "2026-09-04" },
  { reference: "INV-2", amount: "245.50", date: "2026-09-12" }, // short 4.50
  { reference: "INV-4", amount: "500.004", date: "2026-10-06" }, // within tolerance
  { reference: "INV-9", amount: "75.00", date: "2026-10-07" }, // not in ledger
];
const datasets = new Map([ds(template, "left", ledger), ds(template, "right", bank)]);
const result = reconcile({ template, datasets, asOf: "2026-10-31" });
const check = (id: string) => result.checks.find((c) => c.id === id)!;

describe("generic two-file template", () => {
  it("matches on the key, case-insensitively, and flags the differences", () => {
    expect(check("missing_right").count).toBe(3); // INV-3 and both INV-5 rows
    expect(check("missing_right").value).toBe(160);
    expect(check("missing_left").count).toBe(1); // INV-9
    expect(check("amount_mismatch").count).toBe(1); // INV-2 short; INV-4 is within tolerance
    expect(result.exceptions.find((e) => e.check === "amount_mismatch" && e.key === "INV-2")?.diff).toBe(4.5);
    expect(check("duplicate_left").count).toBe(1);
    expect(check("duplicate_right").count).toBe(0);
  });

  it("names checks after the user's files and cleans setup input", () => {
    expect(template.title).toBe("Ledger vs Bank");
    expect(check("missing_right").label).toBe("In Ledger, not in Bank");
    expect(template.confirmColumns).toBe(true);
    expect(cleanLabel("  Bank\n statement  ", "File A")).toBe("Bank statement");
    expect(cleanLabel("   ", "File A")).toBe("File A");
    expect(parseTolerance("1")).toBe(1);
    expect(parseTolerance("-3")).toBe(0.01);
    expect(parseTolerance("abc")).toBe(0.01);
  });
});

describe("what to fix first", () => {
  it("ranks by money at risk weighted by severity, with an action per rule", () => {
    const items = fixFirst(template, result);
    // 160 missing, 75 unknown in bank, 40 duplicated, 4.50 short paid.
    expect(items.map((i) => i.check)).toEqual(["missing_right", "missing_left", "duplicate_left", "amount_mismatch"]);
    expect(items.every((i) => i.action.length > 20)).toBe(true);
    expect(items.find((i) => i.check === "duplicate_left")!.action).toMatch(/duplicate/i);
  });

  it("follows severity before value when values tie", () => {
    const ageing: Template = {
      ...template,
      checks: [
        { id: "old", label: "Old", description: "", rule: { kind: "older_than", link: 0, field: "date", days: 1 } },
        { id: "miss", label: "Missing", description: "", rule: { kind: "unmatched_left", link: 0 } },
      ],
    };
    const r = { ...result, checks: [
      { id: "old", label: "Old", description: "", status: "done" as const, count: 3, value: 100 },
      { id: "miss", label: "Missing", description: "", status: "done" as const, count: 1, value: 100 },
    ] };
    expect(fixFirst(ageing, r).map((i) => i.check)).toEqual(["miss", "old"]);
  });
});

describe("breakdowns", () => {
  const mapped = new Map([
    ["left", new Set(["reference", "amount", "date", "description"])],
    ["right", new Set(["reference", "amount", "date"])],
  ]);

  it("offers key, month and low-cardinality text fields that are mapped", () => {
    const dims = breakdownOptions(template, "missing_right", mapped);
    expect(dims.map((d) => d.key)).toEqual(["key", "month"]);
    expect(dims[0].label).toMatch(/matching key/i);
    expect(breakdownOptions(template, "missing_right", new Map()).map((d) => d.key)).toEqual(["key"]);
  });

  it("groups by month from the rows behind each exception", () => {
    const { rows } = breakdown(template, result, datasets, "amount_mismatch", "month");
    expect(rows.map((r) => r.group)).toEqual(["2026-09", "2026-10"].filter((m) => rows.some((r) => r.group === m)));
    expect(rows.reduce((s, r) => s + r.count, 0)).toBe(check("amount_mismatch").count);
  });

  it("groups by a raw field, with a blank bucket, largest value first", () => {
    const { rows, totalGroups } = breakdown(template, result, datasets, "missing_right", "description");
    // Equal value (80 each): more items first.
    expect(rows).toEqual([
      { group: "Amazon", count: 2, value: 80 },
      { group: "Noon", count: 1, value: 80 },
    ]);
    expect(totalGroups).toBe(2);
    const byKey = breakdown(template, result, datasets, "missing_left", "description");
    expect(byKey.rows[0].group).toBe(BLANK);
  });

  it("describes where a breakdown concentrates", () => {
    expect(describeBreakdown([], "Month")).toMatch(/no exceptions/);
    const text = describeBreakdown(
      [
        { group: "SKU-1", count: 3, value: 300 },
        { group: "SKU-2", count: 1, value: 100 },
      ],
      "SKU",
      "AED",
    );
    expect(text).toContain("SKU-1");
    expect(text).toContain("AED 300.00");
    expect(text).toContain("75%");
  });
});

describe("what the LLM sees", () => {
  it("gets totals, every check and only the top exceptions, never raw rows", () => {
    const digest = digestText(template, result);
    for (const c of result.checks) expect(digest).toContain(c.label);
    expect(digest).toContain("Value at risk");
    expect(digest).not.toContain("Noon"); // a raw cell from the files
    expect(digest).not.toContain("2026-09-03"); // a row date
    expect(digest.split("\n").filter((l) => l.startsWith("Amount mismatch\tINV")).length).toBeLessThanOrEqual(8);
    // Byte-stable, so it can be cached.
    expect(digestText(template, result)).toBe(digest);
  });

  it("emails are built from one check's aggregates and largest items", () => {
    const facts = emailFacts(template, result, "missing_right");
    expect(facts).toContain("Items: 3");
    expect(facts).toContain("INV-3");
    expect(facts).not.toContain("INV-9");
  });

  it("an explanation sees only the rows behind that one exception", () => {
    const i = result.exceptions.findIndex((e) => e.key === "INV-2");
    const facts = exceptionFacts(template, result, i, datasets)!;
    expect(facts).toContain("Ledger row 3");
    expect(facts).toContain("Bank row 3");
    expect(facts).not.toContain("INV-4");
  });

  it("keeps the cached instructions free of anything that changes per run", () => {
    expect(INSTRUCTIONS).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(INSTRUCTIONS.length).toBeGreaterThan(2000);
  });
});

describe("rule-based fallbacks (no API key)", () => {
  it("writes a narrative from the numbers", () => {
    const n = ruleNarrative(template, result);
    expect(n.headline).toMatch(/^Done\. Matched \d+ of 6 rows in your ledger/);
    expect(n.findings.length).toBeGreaterThan(0);
    expect(n.nextSteps.length).toBeLessThanOrEqual(3);
  });

  it("drafts a copyable email and explains an exception", () => {
    const email = ruleEmail(template, result, "amount_mismatch", "counterparty", "Acme Trading");
    expect(email.subject).toContain("Amount mismatch");
    expect(email.body).toContain("INV-2");
    expect(email.body).toContain("Acme Trading");
    const i = result.exceptions.findIndex((e) => e.key === "INV-2");
    expect(ruleExplanation(template, result, i)).toContain("4.50");
  });
});
