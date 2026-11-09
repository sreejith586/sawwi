import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Papa from "papaparse";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bcJournals } from "@/lib/connectors/business-central";
import { DEMO_BC_STORE_CREDENTIALS, mockBusinessCentral } from "@/lib/connectors/mock/business-central";
import { DEMO_STORE_JOURNAL_ID } from "@/lib/connectors/mock/business-central-store-data";
import { resetDemoErpWrites } from "@/lib/connectors/mock";
import type { ConnectorDeps } from "@/lib/connectors/types";
import { DEMO_ORG_KEY } from "@/lib/demo/demo";
import { parseUploads } from "@/lib/files/parse";
import { classify } from "./buckets";
import { buildJournal, CSV_HEADERS, draftFromParsed, emptySettings, journalCsv, type SettlementSettings } from "./journal";
import { parseSettlements } from "./parse";
import { SETTLEMENT_SAMPLES } from "./samples";
import * as service from "./service";

// Marketplace settlements → journal entries (D-70–D-73), end to end against the mock Business
// Central's store company. Invented data; nothing leaves the process.

const env = process.env as Record<string, string | undefined>;
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sawwi-settle-"));
  env.SAWWI_DATA_DIR = dir;
  resetDemoErpWrites();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function parsedSample(id: string) {
  const s = SETTLEMENT_SAMPLES.find((x) => x.id === id)!;
  return parseSettlements(await parseUploads([{ name: s.fileName, data: new TextEncoder().encode(s.text()) }]), s.fileName);
}

const ACCOUNTS: SettlementSettings["accounts"] = {
  payout: "1150", sales: "4010", shipping: "4020", refunds: "4030", promotions: "4040", commission: "6110", fulfilment: "6120",
  storage: "6130", advertising: "6140", other_fees: "6190", fee_vat: "2320", sales_vat: "2310", reserve: "1160", reimbursements: "4090",
};

describe("reading settlement reports", () => {
  it("reads Amazon's long flat file: summary row, refunds kept apart, period and deposit dates", async () => {
    const [s] = await parsedSample("amazon-ae-24681357911");
    expect(s).toMatchObject({ settlementId: "24681357911", marketplace: "Amazon.ae", format: "long", periodStart: "2026-10-01", periodEnd: "2026-10-15", depositDate: "2026-10-17", currency: "AED", statedPayout: 817.43, orders: 4 });
    const cats = Object.fromEntries(s.categories.map((c) => [c.key, c.amount]));
    expect(cats).toMatchObject({ "ItemPrice · Principal": 1414, "Refund · ItemPrice · Principal": -199, "other-transaction · Liquidations": 22.5 });
    expect(s.categories.reduce((a, c) => a + c.amount, 0)).toBeCloseTo(817.43, 2);
  });

  it("reads a wide report with two settlements, one journal each", async () => {
    const ps = await parsedSample("generic-oct");
    expect(ps.map((p) => [p.settlementId, p.statedPayout, p.rows])).toEqual([["S-2026-10-A", 1286.65, 6], ["S-2026-10-B", 868.47, 5]]);
    expect(ps[0].categories.map((c) => c.key).sort()).toEqual(["Commission / referral fee", "Fulfilment fee", "Item price / principal", "Other fees", "VAT on fees"]);
  });

  it("classifies marketplaces' names, CamelCase included, and leaves unknown ones to the user", () => {
    expect(classify("FBAPerUnitFulfillmentFee")).toBe("fulfilment");
    expect(classify("RefundCommission")).toBe("commission");
    expect(classify("Principal", "Refund")).toBe("refunds");
    expect(classify("VAT on fees")).toBe("fee_vat");
    expect(classify("ItemPrice · Tax")).toBe("sales_vat");
    expect(classify("Cost of Advertising")).toBe("advertising");
    expect(classify("Previous Reserve Amount Balance")).toBe("reserve");
    expect(classify("Liquidations")).toBeUndefined();
  });
});

describe("the journal", () => {
  it("balances: categories on their accounts, the payout on clearing; rounding within a cent a row is booked", async () => {
    const [, b] = await parsedSample("generic-oct");
    const j = buildJournal(draftFromParsed(b, emptySettings()), { ...emptySettings(), accounts: ACCOUNTS });
    expect(j.blockers).toEqual([]);
    expect(j.debits).toBe(j.credits);
    expect(j.lines.find((l) => l.bucket === "payout")).toMatchObject({ account: "1150", amount: 868.47 });
    expect(j.lines.find((l) => l.bucket === "sales")).toMatchObject({ account: "4010", amount: -1388 });
    expect(j.warnings.join(" ")).toMatch(/rounding/);
  });

  it("blocks when the amounts don't add up, a category is unclassified or an account is missing", async () => {
    const [a] = await parsedSample("amazon-ae-24681357911");
    const d = draftFromParsed(a, emptySettings());
    const j = buildJournal({ ...d, statedPayout: 900 }, { ...emptySettings(), accounts: { payout: "1150" } });
    expect(j.blockers.join("\n")).toMatch(/a line may be missing/);
    expect(j.blockers.join("\n")).toMatch(/Classify "other-transaction · Liquidations"/);
    expect(j.blockers.join("\n")).toMatch(/Choose the G\/L account for Commission/);
  });

  it("splits output VAT out of sales when sales include VAT, and still balances", async () => {
    const [, b] = await parsedSample("generic-oct");
    const j = buildJournal(draftFromParsed(b, emptySettings()), { ...emptySettings(), accounts: ACCOUNTS, salesVatRate: 5 });
    expect(j.lines.find((l) => l.bucket === "sales_vat")).toMatchObject({ account: "2310", amount: -66.1 });
    expect(j.lines.find((l) => l.bucket === "sales")!.amount).toBe(-1321.9);
    expect(j.debits).toBe(j.credits);
  });

  it("exports one CSV row per line, debit and credit apart", async () => {
    const [, b] = await parsedSample("generic-oct");
    const draft = draftFromParsed(b, emptySettings());
    const csv = Papa.parse<string[]>(journalCsv([{ draft, lines: buildJournal(draft, { ...emptySettings(), accounts: ACCOUNTS }).lines }])).data;
    expect(csv[0]).toEqual(CSV_HEADERS);
    expect(csv.find((r) => r[4] === "1150")).toEqual(["2026-10-28", "S-2026-10-B", "Marketplace", "G/L Account", "1150", "", "Marketplace S-2026-10-B payout", "868.47", "", "868.47", "AED"]);
  });
});

describe("Business Central journal lines (D-71)", () => {
  const sleep = async () => {};
  const line = { accountNumber: "6110", postingDate: "2026-10-28", documentNumber: "T-1", externalDocumentNumber: "Test", amount: 10, description: "x" };

  it("adds unposted lines, finds them by document number, and deletes its own lines if one fails", async () => {
    const writes = new Map<string, Record<string, unknown>[]>();
    const deps: ConnectorDeps = { fetch: mockBusinessCentral({ writes }), sleep };
    expect(await bcJournals.listJournals(DEMO_BC_STORE_CREDENTIALS, deps)).toEqual([{ id: DEMO_STORE_JOURNAL_ID, code: "DEFAULT", name: "Default journal batch" }]);
    await expect(bcJournals.createLines(DEMO_BC_STORE_CREDENTIALS, DEMO_STORE_JOURNAL_ID, [line, { ...line, accountNumber: "9999" }], deps)).rejects.toThrow(/G\/L Account does not exist/);
    expect(await bcJournals.findDocument(DEMO_BC_STORE_CREDENTIALS, DEMO_STORE_JOURNAL_ID, "T-1", deps)).toEqual([]);
    const ok = await bcJournals.createLines(DEMO_BC_STORE_CREDENTIALS, DEMO_STORE_JOURNAL_ID, [line, { ...line, accountNumber: "1150", amount: -10 }], deps);
    expect(ok).toEqual({ company: "Sawwi Demo Store LLC", journal: "DEFAULT", count: 2 });
    expect(await bcJournals.findDocument(DEMO_BC_STORE_CREDENTIALS, DEMO_STORE_JOURNAL_ID, "T-1", deps)).toEqual([{ where: "unposted", detail: "2 unposted lines in the journal batch" }]);
    expect(await bcJournals.findDocument(DEMO_BC_STORE_CREDENTIALS, DEMO_STORE_JOURNAL_ID, "S-2026-10-A", deps)).toEqual([{ where: "posted", detail: "posted on 2026-10-14" }]);
  });

  it("says which permission set to add when journals are read-only", async () => {
    const deps: ConnectorDeps = { fetch: mockBusinessCentral({ readOnly: true }), sleep };
    await expect(bcJournals.createLines(DEMO_BC_STORE_CREDENTIALS, DEMO_STORE_JOURNAL_ID, [line], deps)).rejects.toThrow(/D365 JOURNALS, EDIT/);
  });
});

describe("settlements in the demo store, end to end", () => {
  const ORG = DEMO_ORG_KEY;

  it("captures the samples; the same settlement again isn't captured twice", async () => {
    const generic = await service.captureSample(ORG, "u1", "generic-oct");
    expect(generic.map((r) => [r.settlementId, r.existing])).toEqual([["S-2026-10-A", false], ["S-2026-10-B", false]]);
    expect((await service.captureSample(ORG, "u1", "generic-oct")).every((r) => r.existing)).toBe(true);
    await service.captureSample(ORG, "u1", "amazon-ae-24681357911");
    const { views, target, settings } = await service.listViews(ORG);
    expect(target?.connectionId).toBe("demo:business-central-store");
    expect(settings.journalId).toBe(DEMO_STORE_JOURNAL_ID);
    expect(views).toHaveLength(3);
    expect(views.every((v) => v.status === "needs_review")).toBe(true); // no accounts chosen yet
  });

  it("classifying a category once is remembered for the marketplace", async () => {
    const amazon = (await service.listViews(ORG)).views.find((v) => v.marketplace === "Amazon.ae")!;
    const v = await service.saveEdits(ORG, amazon.id, { buckets: { "other-transaction · Liquidations": "reimbursements" } });
    expect(v.draft.categories.find((c) => c.key.includes("Liquidations"))).toMatchObject({ bucket: "reimbursements", classifiedBy: "user" });
    const { settings } = await service.listViews(ORG);
    expect(settings.categories["Amazon.ae"]["other-transaction · Liquidations"]).toBe("reimbursements");
  });

  it("with accounts mapped, approves in bulk, pushes one, and refuses the one Business Central already has", async () => {
    await service.updateSettings(ORG, { accounts: ACCOUNTS });
    const { views } = await service.listViews(ORG);
    expect(views.map((v) => v.status).sort()).toEqual(["ready", "ready", "ready"]);
    const results = await service.approveMany(ORG, views.map((v) => v.id), "u1");
    expect(results.every((r) => r.ok)).toBe(true);
    const after = (await service.listViews(ORG)).views;
    const a = after.find((v) => v.settlementId === "S-2026-10-A")!;
    const b = after.find((v) => v.settlementId === "S-2026-10-B")!;
    const pushed = await service.pushMany(ORG, [{ id: a.id, hash: a.hash }, { id: b.id, hash: b.hash }], "u1");
    expect(pushed[0]).toMatchObject({ ok: false, message: expect.stringContaining("already in Business Central (posted on 2026-10-14)") });
    expect(pushed[1]).toMatchObject({ ok: true, message: "Marketplace S-2026-10-B: 6 unposted lines in Sawwi Demo Store LLC, batch DEFAULT." });
    expect((await service.getView(ORG, b.id))!.view.status).toBe("pushed");
    expect((await service.pushMany(ORG, [{ id: b.id, hash: b.hash }], "u1"))[0].ok).toBe(false);
  });

  it("a settings change withdraws approvals whose content changed; a stale hash is refused", async () => {
    const amazon = (await service.listViews(ORG)).views.find((v) => v.marketplace === "Amazon.ae")!;
    expect(amazon.status).toBe("approved");
    await service.updateSettings(ORG, { salesVatRate: 5 });
    const now = (await service.getView(ORG, amazon.id))!.view;
    expect(now.status).toBe("ready");
    expect((await service.pushMany(ORG, [{ id: amazon.id, hash: amazon.hash }], "u1"))[0].ok).toBe(false);
  });

  it("a settlement in another currency can't be pushed, only exported", async () => {
    const text = SETTLEMENT_SAMPLES[0].text().replace(/,AED/g, ",SAR").replace(/S-2026-10-/g, "SA-2026-10-");
    const [r] = await service.captureFile(ORG, "u1", { name: "noon-sa.csv", bytes: new TextEncoder().encode(text) });
    const v = (await service.getView(ORG, r.id))!.view;
    expect(v.journal.blockers.join(" ")).toMatch(/in SAR, not AED/);
    const out = await service.exportCsv(ORG, [r.id]);
    expect(out.count).toBe(1);
    expect(out.csv).toContain("SA-2026-10-A");
  });
});
