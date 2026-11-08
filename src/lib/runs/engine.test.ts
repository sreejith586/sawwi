import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { answerQuestion, ingestFile } from "./engine";
import { fingerprintHeaders } from "@/lib/files/profile";
import * as store from "./store";
import { buildRunView } from "./view";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sawwi-test-"));
  process.env.SAWWI_DATA_DIR = dir;
  // Heuristics only: these tests must never call the API.
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const csv = (rows: string[][]) => new TextEncoder().encode(rows.map((r) => r.join(",")).join("\n"));

// Synthetic Magento 2 order export and gateway settlement; order refs carry a "#" in the gateway file.
const orders = (ids: string[]) =>
  csv([
    ["ID", "Purchase Date", "Grand Total (Purchased)", "Status", "Payment Method", "Total Refunded"],
    ...ids.map((id, i) => [id, `2026-10-0${i + 1} 10:00:00`, `${100 + i}.00`, "complete", "Card", "0.00"]),
  ]);
const gateway = (ids: string[]) =>
  csv([
    ["Reference", "Action ID", "Action Type", "Processed On", "Amount", "Fee", "Net", "Payout ID"],
    ...ids.map((id, i) => [`#${id}`, `act_${i}`, "Capture", `03/0${i + 1}/2026`, `${100 + i}.00`, "2.90", `${97.1 + i}`, "po_1"]),
  ]);

const ctx = { countries: ["AE" as const] };

describe("run engine", () => {
  it("asks only what it can't infer, then remembers everything for the next run", async () => {
    const ids = ["100000101", "100000102", "100000103", "100000104", "100000105"];
    const run = await store.createRun("acme", "web-orders-vs-gateway");

    await ingestFile(run, "orders", "orders.csv", orders(ids), ctx);
    let view = (await buildRunView(run.id))!;
    expect(view.status).toBe("collecting");
    const orderFields = Object.fromEntries(view.slots[0].file!.fields.map((f) => [f.key, f.column]));
    expect(orderFields.order_id).toBe("ID");
    expect(orderFields.order_total).toBe("Grand Total (Purchased)");

    await ingestFile(run, "gateway", "gateway.csv", gateway(ids), ctx);

    // Answer whatever it asks, preferring Yes/Day-first/the first suggested column.
    for (let i = 0; i < 10; i++) {
      view = (await buildRunView(run.id))!;
      const q = view.openQuestions[0];
      if (!q) break;
      const pick = q.options.find((o) => o.value === "yes" || o.value === "DMY") ?? q.options[0];
      await answerQuestion((await store.getRun(run.id))!, q.id, pick.value);
    }
    view = (await buildRunView(run.id))!;
    expect(view.status).toBe("ready");
    expect(view.usage.calls).toBe(0);

    const asked = (await store.getQuestions(run.id)).map((q) => q.payload.kind);
    expect(asked).toContain("date_format"); // 03/01/2026 could be either way round
    expect(asked).toContain("key_format"); // "#100000101" vs "100000101"
    expect(asked.length).toBeLessThanOrEqual(5);

    // Second run, same layouts, new data: nothing to ask.
    const ids2 = ["100000201", "100000202", "100000203", "100000204"];
    const run2 = await store.createRun("acme", "web-orders-vs-gateway");
    await ingestFile(run2, "orders", "orders-nov.csv", orders(ids2), ctx);
    await ingestFile(run2, "gateway", "gateway-nov.csv", gateway(ids2), ctx);
    const view2 = (await buildRunView(run2.id))!;
    expect(view2.openQuestions).toEqual([]);
    expect(view2.status).toBe("ready");
    expect(view2.slots.every((s) => s.file?.remembered)).toBe(true);
  });

  it("keeps memory per company", async () => {
    const run = await store.createRun("other-co", "web-orders-vs-gateway");
    await ingestFile(run, "gateway", "gateway.csv", gateway(["1", "2", "3"]), ctx);
    expect((await buildRunView(run.id))!.slots.find((s) => s.key === "gateway")!.file!.remembered).toBe(false);
  });
});

describe("remembered layouts and template changes (D-54)", () => {
  it("maps a field the template gained after the layout was remembered, by name, asking nothing", async () => {
    const headers = ["SKU", "Description", "Inventory", "Unit price"];
    const file = csv([headers, ["OUD-50", "Oud perfume 50 ml", "4.00", "285.00"], ["SND-42", "Leather sandals, 42", "20.00", "199.00"]]);
    // Remembered before the stock template had a unit price field.
    await store.saveCachedMapping("acme", "web-erp-stock", "erp_stock", fingerprintHeaders(headers), {
      fields: { sku: { column: "SKU", source: "auto", confidence: 1 }, description: { column: "Description", source: "auto", confidence: 1 }, erp_qty: { column: "Inventory", source: "auto", confidence: 1 } },
      dateFormats: {},
    });
    const run = await store.createRun("acme", "web-erp-stock");
    await ingestFile(run, "erp_stock", "items.csv", file, ctx);
    const slot = (await buildRunView(run.id))!.slots.find((s) => s.key === "erp_stock")!;
    expect(slot.file!.remembered).toBe(false); // one field is new, so not all of it was remembered
    expect(Object.fromEntries(slot.file!.fields.map((f) => [f.key, f.column]))).toMatchObject({ sku: "SKU", erp_qty: "Inventory", unit_price: "Unit price" });
    expect((await buildRunView(run.id))!.openQuestions).toEqual([]);
  });
});
