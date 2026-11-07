import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as runStore from "@/lib/runs/store";
import { runReconciliation } from "@/lib/runs/reconcile";
import { buildRunView } from "@/lib/runs/view";
import { BC_API_HOST, BC_REPORTS, businessCentral, deliveryNoteFor, normaliseTenant, num, pickCompany, windowFilter } from "./business-central";
import { DEMO_BC_CREDENTIALS, mockBusinessCentral } from "./mock/business-central";
import { activeMocks } from "./mock";
import { slotFit } from "./slot-fit";
import { addConnection, pullIntoRun } from "./service";
import * as store from "./store";
import { ConnectorError, type ConnectorDeps, type FetchLike } from "./types";

// Everything runs against the in-process mock tenant (./mock): nothing calls Microsoft.

const creds = businessCentral.parseCredentials({ ...DEMO_BC_CREDENTIALS });
const october = { from: "2026-10-01", to: "2026-10-31" };
const mockDeps = (pageSize = 2, log?: { method: string; url: string }[]): ConnectorDeps => ({ fetch: mockBusinessCentral({ pageSize, log }), sleep: async () => {} });

/** Scripted replies for error paths the mock doesn't produce. */
function scripted(replies: { status: number; body?: unknown; headers?: Record<string, string> }[]) {
  const sleeps: number[] = [];
  const fetch: FetchLike = async () => {
    const r = replies.shift();
    if (!r) throw new Error("Unexpected extra request");
    return { ok: r.status < 300, status: r.status, headers: { get: (n: string) => r.headers?.[n] ?? null }, json: async () => r.body ?? {} };
  };
  return { deps: { fetch, sleep: async (ms: number) => void sleeps.push(ms) } as ConnectorDeps, sleeps };
}
const token = { status: 200, body: { access_token: "t" } };

beforeAll(() => {
  process.env.SAWWI_CONNECTOR_KEY = randomBytes(32).toString("base64");
});

describe("Business Central credentials", () => {
  it("validates tenant, environment, client ID and secret, so the hosts can't be redirected", () => {
    expect([num(7350), num(9.5), num(0.33333), num(-2), num(null)]).toEqual(["7350.00", "9.50", "0.33333", "-2.00", ""]);
    expect(normaliseTenant(" Contoso.OnMicrosoft.com ")).toBe("contoso.onmicrosoft.com");
    expect(normaliseTenant("72f988bf-86f1-41af-91ab-2d7cd011db47")).toBe("72f988bf-86f1-41af-91ab-2d7cd011db47");
    for (const bad of ["169.254.169.254", "evil.com/x", "a b", ""]) expect(() => normaliseTenant(bad)).toThrow(ConnectorError);
    const ok = { ...DEMO_BC_CREDENTIALS };
    expect(() => businessCentral.parseCredentials({ ...ok, environment: "../prod" })).toThrow(/environment/);
    expect(() => businessCentral.parseCredentials({ ...ok, clientId: "not-a-guid" })).toThrow(/client\) ID/);
    expect(() => businessCentral.parseCredentials({ ...ok, clientSecret: "short" })).toThrow(/secret/);
    expect(businessCentral.parseCredentials({ ...ok, company: "" }).company).toBe("");
  });

  it("picks the company by name, display name or ID, and lists them when it's ambiguous", () => {
    const cs = [
      { id: "a", name: "CRONUS", displayName: "Cronus Ltd" },
      { id: "b", name: "OTHER", displayName: "Other Co" },
    ];
    expect(pickCompany(cs, "cronus ltd").id).toBe("a");
    expect(pickCompany(cs, "B").id).toBe("b");
    expect(pickCompany([cs[0]], "").id).toBe("a");
    expect(() => pickCompany(cs, "")).toThrow(/Cronus Ltd, Other Co/);
    expect(() => pickCompany(cs, "nope")).toThrow(/No company/);
  });

  it("tests the connection with a token and a company lookup", async () => {
    const log: { method: string; url: string }[] = [];
    expect(await businessCentral.test(creds, mockDeps(2, log))).toEqual({ accountLabel: "Sawwi Demo Trading LLC (Sandbox)" });
    expect(log.map((l) => l.method)).toEqual(["POST", "GET"]);
    expect(log[0].url).toBe("https://login.microsoftonline.com/sawwi-demo.onmicrosoft.com/oauth2/v2.0/token");
    expect(log[1].url).toBe(`${BC_API_HOST}/v2.0/sawwi-demo.onmicrosoft.com/Sandbox/api/v2.0/companies`);
  });

  it("explains sign-in and setup problems in words the customer can act on", async () => {
    await expect(businessCentral.test({ ...creds, clientSecret: "wrong-secret-value" }, mockDeps())).rejects.toThrow(/client secret/);
    await expect(businessCentral.test({ ...creds, clientId: "11111111-1111-4111-8111-111111111111" }, mockDeps())).rejects.toThrow(/No app with that client ID/);
    await expect(businessCentral.test({ ...creds, tenantId: "other.onmicrosoft.com" }, mockDeps())).rejects.toThrow(/can't find that tenant/);
    await expect(businessCentral.test({ ...creds, environment: "Production" }, mockDeps())).rejects.toThrow(/No Business Central environment named “Production”/);
    await expect(businessCentral.test({ ...creds, company: "" }, mockDeps())).rejects.toThrow(/several companies/);
    await expect(businessCentral.test(creds, scripted([token, { status: 401 }]).deps)).rejects.toThrow(/Microsoft Entra Applications/);
    await expect(businessCentral.test(creds, scripted([token, { status: 403 }]).deps)).rejects.toThrow(/D365 READ/);
    await expect(businessCentral.test(creds, scripted([{ status: 400, body: { error: "invalid_client", error_description: "AADSTS7000222: expired" } }]).deps)).rejects.toThrow(/expired/);
  });

  it("backs off on 429 and refuses a nextLink to another host", async () => {
    const companies = { status: 200, body: { value: [{ id: "c1", name: "X", displayName: "X" }] } };
    const busy = scripted([token, { status: 429, headers: { "Retry-After": "3" } }, companies]);
    expect((await businessCentral.test({ ...creds, company: "" }, busy.deps)).accountLabel).toBe("X (Sandbox)");
    expect(busy.sleeps).toEqual([3000]);

    const evil = scripted([token, companies, { status: 200, body: { value: [{ currencyCode: "AED" }] } }, { status: 200, body: { value: [], "@odata.nextLink": "https://evil.example/next" } }]);
    await expect(businessCentral.pull({ ...creds, company: "" }, "sales_invoices", october, evil.deps)).rejects.toThrow(/another host/);
  });
});

describe("Business Central reports", () => {
  it("filters by whole days and pages through results", async () => {
    expect(windowFilter("postingDate", october)).toBe("postingDate ge 2026-10-01 and postingDate le 2026-10-31");
    const log: { method: string; url: string }[] = [];
    const t = await businessCentral.pull(creds, "sales_invoices", october, mockDeps(2, log));
    const pages = log.filter((l) => l.url.includes("/salesInvoices"));
    expect(pages.length).toBe(4); // 7 invoices, 2 per page
    expect(decodeURIComponent(pages[0].url)).toContain("$filter=postingDate ge 2026-10-01 and postingDate le 2026-10-31");
    expect(t.rows.map((r) => r[0])).toEqual(["SI-3103", "SI-3101", "SI-3102", "SI-3104", "SI-3105", "SI-3106"]); // draft SI-3107 left out
    expect(t.rows[1]).toEqual(["SI-3101", "", "SO-1041", "C0001", "Al Waha Hotels", "2026-10-07", "2026-10-07", "2026-10-28", "AED", "7000.00", "350.00", "7350.00", "0.00", "Paid"]);

    const firstWeek = await businessCentral.pull(creds, "sales_invoices", { from: "2026-10-01", to: "2026-10-07" }, mockDeps());
    expect(firstWeek.rows.map((r) => r[0])).toEqual(["SI-3103", "SI-3101"]);
  });

  it("returns fixed columns for every report", async () => {
    const counts: Record<string, number> = {};
    for (const spec of BC_REPORTS) {
      const t = await businessCentral.pull(creds, spec.id, october, mockDeps(50));
      expect(t.headers).toEqual([...spec.columns]);
      for (const row of t.rows) expect(row).toHaveLength(spec.columns.length);
      counts[spec.id] = t.rows.length;
    }
    expect(counts).toEqual({
      sales_invoices: 6,
      sales_invoice_lines: 7,
      sales_credit_memos: 1,
      sales_order_lines: 5,
      sales_shipment_lines: 6,
      purchase_order_lines: 4,
      purchase_receipt_lines: 3,
      purchase_invoice_lines: 3,
    });
  });

  it("finds each invoice line's delivery note from its order when that is unambiguous", async () => {
    const t = await businessCentral.pull(creds, "sales_invoice_lines", october, mockDeps(50));
    const dn = Object.fromEntries(t.rows.map((r) => [`${r[0]} ${r[6]}`, r[5]]));
    expect(dn).toEqual({
      "SI-3103 CBL-25": "SSH-2104",
      "SI-3101 FAN-1200": "SSH-2101",
      "SI-3101 LED-40": "SSH-2101", // SO-1041 shipped LED-40 twice; the quantity (50) decides
      "SI-3102 AC-18K": "SSH-2103",
      "SI-3104 LED-40": "SSH-2102",
      "SI-3105 LED-40": "SSH-2105",
      "SI-3106 LED-40": "", // no order, so no delivery to point at
    });
    const index = new Map([["SO-1\u0000X", [{ dn: "A", qty: 5 }, { dn: "B", qty: 5 }]]]);
    expect(deliveryNoteFor(index, "SO-1", "X", 5)).toBe(""); // two equal shipments: leave it blank
  });

  it("suggests the right report for a slot key that means different things in different templates", () => {
    const best = (templateId: string, slot: string) =>
      [...BC_REPORTS].sort((a, b) => slotFit(b.slots, templateId, slot) - slotFit(a.slots, templateId, slot))[0].id;
    expect(best("p2p-three-way-match", "invoices")).toBe("purchase_invoice_lines");
    expect(best("b2b-order-delivery-invoice", "invoices")).toBe("sales_invoice_lines");
    expect(best("b2b-cash-application", "invoices")).toBe("sales_invoices");
    expect(best("p2p-three-way-match", "grn")).toBe("purchase_receipt_lines");
    expect(best("b2b-returns-vs-credit-notes", "credit_notes")).toBe("sales_credit_memos");
  });

  it("is switched on only by SAWWI_CONNECTOR_MOCK and never in production", () => {
    const env = process.env as Record<string, string | undefined>;
    const before = { mock: env.SAWWI_CONNECTOR_MOCK, node: env.NODE_ENV };
    try {
      delete env.SAWWI_CONNECTOR_MOCK;
      expect(activeMocks()).toHaveLength(0);
      env.SAWWI_CONNECTOR_MOCK = "business-central";
      expect(activeMocks().map((m) => m.id)).toEqual(["business-central"]);
      env.NODE_ENV = "production";
      expect(activeMocks()).toHaveLength(0);
    } finally {
      env.SAWWI_CONNECTOR_MOCK = before.mock;
      env.NODE_ENV = before.node;
    }
  });
});

describe("Business Central data runs the B2B and purchasing reconciliations", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "sawwi-bc-"));
    process.env.SAWWI_DATA_DIR = dir;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  async function reconcileFrom(templateId: string, slots: Record<string, string>, reconcile = true) {
    const conn = store.listConnections("acme")[0] ?? (await addConnection("acme", "business-central", { ...DEMO_BC_CREDENTIALS }, null, mockDeps()));
    const run = runStore.createRun("acme", templateId);
    for (const [slot, report] of Object.entries(slots)) await pullIntoRun(run, slot, conn.id, report, october, { countries: ["AE"] }, mockDeps());
    const view = buildRunView(run.id)!;
    return { view, result: reconcile ? runReconciliation(runStore.getRun(run.id)!, ["AE"]) : undefined! };
  }

  it("stores the secret encrypted and labels the connection with the company", async () => {
    const conn = await addConnection("acme", "business-central", { ...DEMO_BC_CREDENTIALS }, null, mockDeps());
    expect(conn.accountLabel).toBe("Sawwi Demo Trading LLC (Sandbox)");
    expect(store.getConnectionSecret("acme", conn.id)).not.toContain(DEMO_BC_CREDENTIALS.clientSecret);
    expect(JSON.stringify(store.listConnections("acme"))).not.toContain(DEMO_BC_CREDENTIALS.clientSecret);
  });

  it("sales orders vs deliveries vs invoices: every field maps by name, no questions, planted exceptions found", async () => {
    const { view, result } = await reconcileFrom("b2b-order-delivery-invoice", { orders: "sales_order_lines", deliveries: "sales_shipment_lines", invoices: "sales_invoice_lines" });
    expect(view.openQuestions).toEqual([]);
    const mapped = (slot: string) => Object.fromEntries((view.slots.find((s) => s.key === slot)!.file?.fields ?? []).map((x) => [x.key, x.column]));
    expect(mapped("orders")).toMatchObject({ so_no: "Sales order no.", customer_po: "Customer PO no.", sku: "SKU", qty_ordered: "Qty ordered", unit_price: "Unit price" });
    expect(mapped("deliveries")).toMatchObject({ dn_no: "Delivery note no.", so_no: "Sales order no.", sku: "SKU", qty_delivered: "Qty delivered", delivery_date: "Delivery date" });
    expect(mapped("invoices")).toMatchObject({ invoice_no: "Invoice number", so_no: "Sales order no.", dn_no: "Delivery note no.", sku: "SKU", qty_invoiced: "Quantity", line_amount: "Line amount" });
    const found = result.exceptions.map((e) => `${e.check}: ${e.key}`).sort();
    expect(found).toEqual([
      "invoiced_not_delivered: LED-40", // SI-3106, invoiced with no order or delivery
      "open_orders: SO-1043 / CBL-25", // nothing delivered yet
      "qty_mismatch: SSH-2103 / AC-18K", // delivered 5, invoiced 4
    ]);
  });

  it("three-way match: PO vs GRN vs vendor invoice finds every planted exception", async () => {
    const { view, result } = await reconcileFrom("p2p-three-way-match", { po: "purchase_order_lines", grn: "purchase_receipt_lines", invoices: "purchase_invoice_lines" });
    expect(view.openQuestions).toEqual([]);
    const mapped = (slot: string) => Object.fromEntries((view.slots.find((s) => s.key === slot)!.file?.fields ?? []).map((x) => [x.key, x.column]));
    expect(mapped("po")).toMatchObject({ po_no: "PO number", supplier: "Supplier", sku: "SKU", qty_ordered: "Qty ordered", po_price: "PO unit price (excl. VAT)" });
    expect(mapped("grn")).toMatchObject({ grn_no: "GRN number", po_no: "PO number", qty_received: "Qty received", grn_date: "Received date" });
    expect(mapped("invoices")).toMatchObject({ invoice_no: "Supplier invoice no.", po_no: "PO number", qty_invoiced: "Qty invoiced", line_amount: "Line amount (excl. VAT)" });
    const found = result.exceptions.map((e) => `${e.check}: ${e.key}`).sort();
    expect(found).toEqual([
      "invoiced_not_received: LED-40", // GLS-2307: no PO, no receipt
      "no_po: LED-40",
      "overdue_po: PO-7004 / AC-18K", // nothing received
      "price_above_po: PO-7003 / FAN-1200", // invoiced at 165 against 160
      "received_not_invoiced: PO-7002 / LED-40",
      "short_received: PO-7001 / AC-18K",
      "short_received: PO-7003 / FAN-1200",
    ]);
    expect(result.exceptions.find((e) => e.check === "price_above_po")).toMatchObject({ leftValue: 16500, rightValue: 16000, diff: 500 });
  });

  it("cash application maps the sales invoice report by name", async () => {
    const cash = await reconcileFrom("b2b-cash-application", { invoices: "sales_invoices" }, false);
    const inv = Object.fromEntries((cash.view.slots.find((s) => s.key === "invoices")!.file?.fields ?? []).map((x) => [x.key, x.column]));
    expect(inv).toMatchObject({ invoice_no: "Invoice number", customer: "Customer", invoice_date: "Invoice date", due_date: "Due date", invoice_amount: "Invoice amount (incl. VAT)", open_amount: "Open amount", currency: "Currency" });
  });
});
