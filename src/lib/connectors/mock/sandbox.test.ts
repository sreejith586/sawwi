import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bcOpenOrderLines, bcPrepareOrderInvoice, bcPurchaseInvoices, bcReceipts } from "../business-central";
import { loadSandbox, sandboxBooks, sandboxCredentials, sandboxPath, type SandboxFile } from "./sandbox";

// The local mock Business Central sandbox (D-94), with invented data.

const FILE: SandboxFile = {
  company: "Test Sandbox KSA",
  currency: "SAR",
  vatPercent: 15,
  vendors: [{ number: "V1", name: "Example Perfumes Co.", trn: "300000000000003" }],
  items: [{ number: "ITM-1", name: "Eau de parfum 100 ml", gtin: "4006381333931" }],
  purchaseOrders: [{ number: "PO-1", date: "2026-11-01", vendor: "V1", lines: [{ item: "ITM-1", qty: 10, price: 100, received: 10 }] }],
  purchaseReceipts: [{ number: "PR-1", date: "2026-11-05", vendor: "V1", order: "PO-1", lines: [{ item: "ITM-1", qty: 10, price: 100 }] }],
};

const env = process.env as Record<string, string | undefined>;
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sawwi-sandbox-"));
  writeFileSync(path.join(dir, "sandbox.json"), JSON.stringify(FILE));
});
afterAll(() => {
  delete env.SAWWI_MOCK_BC_SANDBOX;
  rmSync(dir, { recursive: true, force: true });
});

describe("local mock Business Central sandbox (D-94)", () => {
  it("is off unless a file is named, and always off in production", async () => {
    delete env.SAWWI_MOCK_BC_SANDBOX;
    expect(sandboxPath()).toBeUndefined();
    env.SAWWI_MOCK_BC_SANDBOX = path.join(dir, "sandbox.json");
    expect(sandboxPath()).toBe(env.SAWWI_MOCK_BC_SANDBOX);
    const nodeEnv = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      expect(sandboxPath()).toBeUndefined();
      expect(await loadSandbox()).toBeUndefined();
    } finally {
      env.NODE_ENV = nodeEnv;
    }
  });

  it("serves the file's vendors, items, POs and GRNs through the real connector, and takes PO-based pushes", async () => {
    env.SAWWI_MOCK_BC_SANDBOX = path.join(dir, "sandbox.json");
    const { file, deps } = (await loadSandbox())!;
    const creds = sandboxCredentials(file);
    const md = await bcPurchaseInvoices.masterData(creds, deps);
    expect(md).toMatchObject({ company: "Test Sandbox KSA", lcy: "SAR", vendors: [{ number: "V1", trn: "300000000000003" }], items: [{ number: "ITM-1", gtin: "4006381333931" }] });
    const [line] = await bcOpenOrderLines(creds, { vendorNumber: "V1" }, deps);
    expect(line).toMatchObject({ orderNumber: "PO-1", itemNumber: "ITM-1", received: 10, invoiced: 0, receipts: ["PR-1"] });
    expect(await bcReceipts(creds, { vendorNumber: "V1", since: "2026-10-01" }, deps)).toMatchObject([{ number: "PR-1", orderNumber: "PO-1", lines: [{ itemNumber: "ITM-1", quantity: 10 }] }]);
    const done = await bcPrepareOrderInvoice(creds, [{ orderId: line.orderId, orderNumber: "PO-1", vendorNumber: "V1", lines: [{ lineId: line.lineId, itemNumber: "ITM-1", invoiceQuantity: 4, directUnitCost: 100 }] }], deps);
    expect(done).toEqual({ company: "Test Sandbox KSA", orders: ["PO-1"] });
  });

  it("charges the sandbox's VAT rate on draft invoices it creates", async () => {
    env.SAWWI_MOCK_BC_SANDBOX = path.join(dir, "sandbox.json");
    const { file, deps } = (await loadSandbox())!;
    const created = await bcPurchaseInvoices.createDraft(
      sandboxCredentials(file),
      { vendorNumber: "V1", vendorInvoiceNumber: "X-1", invoiceDate: "2026-11-20", dueDate: "", currency: "SAR", lines: [{ type: "item", number: "ITM-1", description: "", quantity: 2, directUnitCost: 100 }] },
      deps,
    );
    expect(created.totalIncludingTax).toBe(230);
    expect(sandboxBooks(FILE).company.id).toBe(sandboxBooks(FILE).company.id);
  });
});
