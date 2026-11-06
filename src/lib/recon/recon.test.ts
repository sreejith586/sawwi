import { describe, expect, it } from "vitest";
import { parseNumber } from "@/lib/files/profile";
import { getTemplate } from "@/lib/templates/catalog";
import { compile } from "./expr";
import { parseDate, type Dataset, type Rec } from "./load";
import { reconcile, type ReconResult } from "./match";

// Build datasets straight from field-keyed rows (what loadDataset produces after mapping).
function ds(templateId: string, slotKey: string, rows: Record<string, string>[]): [string, Dataset] {
  const slot = getTemplate(templateId)!.sources.find((s) => s.key === slotKey)!;
  const recs: Rec[] = rows.map((row, i) => {
    const rec: Rec = { slot: slotKey, rowNumber: i + 2, raw: {}, num: {}, date: {} };
    for (const f of slot.fields) {
      if (!(f.key in row)) continue;
      rec.raw[f.key] = row[f.key];
      if (f.type === "money" || f.type === "number" || f.type === "percent") rec.num[f.key] = parseNumber(row[f.key]);
      if (f.type === "date") rec.date[f.key] = parseDate(row[f.key], "ISO");
    }
    return rec;
  });
  return [slotKey, { slot, fileName: `${slotKey}.csv`, rows: recs }];
}

function run(templateId: string, sets: [string, Dataset][], asOf?: string): ReconResult {
  return reconcile({ template: getTemplate(templateId)!, datasets: new Map(sets), asOf });
}
const check = (r: ReconResult, id: string) => r.checks.find((c) => c.id === id)!;
const keysOf = (r: ReconResult, id: string) => r.exceptions.filter((e) => e.check === id).map((e) => e.key);

describe("expressions", () => {
  it("evaluates arithmetic with abs, precedence and missing fields", () => {
    const get = (f: string) => ({ principal: -200, commission_pct: 15, fixed_fee: 2 })[f];
    expect(compile("abs(principal) * commission_pct / 100 + fixed_fee").evaluate(get)).toBe(32);
    expect(compile("missing_field + 5").evaluate(get)).toBe(5);
    expect(compile("10 / 0").evaluate(get)).toBe(0);
    expect(compile("-(2 + 3) * 2").evaluate(get)).toBe(-10);
    expect(() => compile("principal; drop table")).toThrow();
  });
});

describe("date parsing", () => {
  it("reads common export formats into ISO", () => {
    expect(parseDate("2026-10-03 14:00:00", "ISO")).toBe("2026-10-03");
    expect(parseDate("03/10/2026", "DMY")).toBe("2026-10-03");
    expect(parseDate("10/03/2026", "MDY")).toBe("2026-10-03");
    expect(parseDate("03/10/2026", "AMBIGUOUS")).toBe("2026-10-03"); // GCC default: day first
    expect(parseDate("Oct 3, 2026 10:12:00 AM", "TEXT_MONTH")).toBe("2026-10-03");
    expect(parseDate("3-Oct-26", "TEXT_MONTH")).toBe("2026-10-03");
    expect(parseDate("not a date", "ISO")).toBeUndefined();
  });
});

describe("3-way match: PO vs GRN vs supplier invoice", () => {
  const T = "p2p-three-way-match";
  const result = run(T, [
    ds(T, "po", [
      { po_no: "PO-1", supplier: "Acme", sku: "A", qty_ordered: "10", po_price: "5.00", expected_date: "2026-10-01" },
      { po_no: "PO-1", supplier: "Acme", sku: "B", qty_ordered: "4", po_price: "20.00", expected_date: "2026-10-01" },
      { po_no: "PO-2", supplier: "Acme", sku: "C", qty_ordered: "6", po_price: "10.00", expected_date: "2026-10-05" },
      { po_no: "PO-3", supplier: "Beta", sku: "D", qty_ordered: "3", po_price: "8.00", expected_date: "2026-10-01" },
    ]),
    ds(T, "grn", [
      // A delivered in two parts, 1 unit rejected; B over-received; C short; D nothing received.
      { grn_no: "G1", po_no: "po-1", sku: "A", qty_received: "6", grn_date: "2026-10-02" },
      { grn_no: "G2", po_no: "PO-1", sku: "A", qty_received: "4", qty_rejected: "1", grn_date: "2026-10-04" },
      { grn_no: "G3", po_no: "PO-1", sku: "B", qty_received: "5", grn_date: "2026-10-02" },
      { grn_no: "G4", po_no: "PO-2", sku: "C", qty_received: "4", grn_date: "2026-10-06" },
      { grn_no: "G5", po_no: "PO-9", sku: "Z", qty_received: "1", grn_date: "2026-10-06" },
    ]),
    ds(T, "invoices", [
      { invoice_no: "INV-1", supplier: "Acme", po_no: "PO-1", sku: "A", qty_invoiced: "10", line_amount: "50.00", invoice_date: "2026-10-05" },
      { invoice_no: "INV-1", supplier: "Acme", po_no: "PO-1", sku: "A", qty_invoiced: "10", line_amount: "50.00", invoice_date: "2026-10-05" },
      { invoice_no: "INV-2", supplier: "Acme", po_no: "PO-1", sku: "B", qty_invoiced: "4", line_amount: "88.00", invoice_date: "2026-10-05" },
      { invoice_no: "INV-3", supplier: "Beta", po_no: "PO-3", sku: "D", qty_invoiced: "3", line_amount: "24.00", invoice_date: "2026-10-06" },
      { invoice_no: "INV-4", supplier: "Gamma", po_no: "PO-7", sku: "X", qty_invoiced: "1", line_amount: "15.00", invoice_date: "2026-10-06" },
    ]),
  ]);

  it("holds invoices for goods that weren't received or exceed accepted quantity", () => {
    expect(keysOf(result, "invoiced_not_received").sort()).toEqual(["PO-3 / D", "PO-7 / X"]);
    expect(check(result, "invoiced_not_received").value).toBe(39);
    // 20 invoiced (incl. a duplicate line) against 9 accepted (10 received − 1 rejected).
    const over = result.exceptions.find((e) => e.check === "qty_over_received")!;
    expect([over.key, over.leftValue, over.rightValue]).toEqual(["po-1 / A", 9, 20]);
  });

  it("checks billed amounts against the PO price, PO existence and duplicates", () => {
    const price = result.exceptions.filter((e) => e.check === "price_above_po");
    expect(price.map((e) => [e.key, e.diff])).toEqual([["PO-1 / B", 8]]);
    expect(keysOf(result, "no_po")).toEqual(["PO-7 / X"]);
    expect(keysOf(result, "duplicate_invoice")).toEqual(["Acme / INV-1 / A"]);
  });

  it("tracks the receiving side: GRNI, over/short receipts, unknown POs and overdue POs", () => {
    expect(keysOf(result, "received_not_invoiced")).toEqual(["PO-2 / C", "PO-9 / Z"]);
    expect(keysOf(result, "over_received")).toEqual(["PO-1 / B"]);
    expect(keysOf(result, "short_received")).toEqual(["PO-2 / C"]);
    expect(keysOf(result, "grn_no_po")).toEqual(["PO-9 / Z"]);
    expect(keysOf(result, "overdue_po")).toEqual(["PO-3 / D"]);
    expect(check(result, "overdue_po").value).toBe(24);
  });
});

describe("orders vs gateway", () => {
  const T = "web-orders-vs-gateway";
  const result = run(T, [
    ds(T, "orders", [
      { order_id: "1001", order_date: "2026-10-01", payment_method: "Card", order_total: "100.00", refunded_amount: "0" },
      { order_id: "1002", order_date: "2026-10-01", payment_method: "Card", order_total: "250.00", refunded_amount: "0" },
      { order_id: "1003", order_date: "2026-10-02", payment_method: "Card", order_total: "80.00", refunded_amount: "0" },
      { order_id: "1004", order_date: "2026-10-02", payment_method: "Cash On Delivery", order_total: "60.00", refunded_amount: "0" },
      { order_id: "1005", order_date: "2026-10-03", payment_method: "Card", order_total: "90.00", refunded_amount: "90.00" },
    ]),
    ds(T, "gateway", [
      { order_ref: "1001", transaction_type: "Capture", transaction_date: "2026-10-01", gross_amount: "100.00", net_amount: "97.10" },
      { order_ref: "1002", transaction_type: "Capture", transaction_date: "2026-10-01", gross_amount: "240.00", net_amount: "233.00" },
      { order_ref: "1005", transaction_type: "Capture", transaction_date: "2026-10-03", gross_amount: "90.00", net_amount: "87.40" },
      { order_ref: "1005", transaction_type: "Refund", transaction_date: "2026-10-04", gross_amount: "-90.00", net_amount: "-90.00" },
      { order_ref: "9999", transaction_type: "Capture", transaction_date: "2026-10-04", gross_amount: "40.00", net_amount: "38.80" },
      { order_ref: "1001", transaction_type: "Chargeback", transaction_date: "2026-10-05", gross_amount: "0", net_amount: "0" },
    ]),
  ]);

  it("flags paid orders with no capture, but not cash-on-delivery orders", () => {
    expect(keysOf(result, "paid_not_settled")).toEqual(["1003"]);
  });
  it("nets captures and refunds per order before comparing", () => {
    expect(keysOf(result, "amount_mismatch")).toEqual(["1002"]);
    expect(result.exceptions.find((e) => e.check === "amount_mismatch")!.diff).toBe(10);
  });
  it("finds settlements with no order and chargebacks", () => {
    expect(keysOf(result, "settled_no_order")).toEqual(["9999"]);
    expect(check(result, "chargeback").count).toBe(1);
  });
  it("reports unautomated checks honestly", () => {
    expect(check(result, "fee_rate").status).toBe("manual");
  });
  it("summarises the link", () => {
    expect(result.links[0]).toMatchObject({ leftRows: 5, rightRows: 6, matchedLeft: 3, groups: 3, withinTolerance: 2 });
  });
});

describe("cash application with invoice numbers inside narrations", () => {
  const T = "b2b-cash-application";
  const result = run(T, [
    ds(T, "invoices", [
      { invoice_no: "INV/2026/0001", customer: "A", invoice_date: "2026-09-01", due_date: "2026-10-01", invoice_amount: "1,000.00" },
      { invoice_no: "INV/2026/0002", customer: "B", invoice_date: "2026-09-05", due_date: "2026-10-05", invoice_amount: "500.00" },
      { invoice_no: "INV/2026/0003", customer: "C", invoice_date: "2026-09-10", due_date: "2026-11-30", invoice_amount: "750.00" },
    ]),
    ds(T, "receipts", [
      { receipt_date: "2026-10-02", reference: "INWARD TT CUSTOMER A INV/2026/0001", amount: "1000.00" },
      { receipt_date: "2026-10-06", reference: "TT INV-2026-0002 LESS BANK CHG", amount: "485.00" },
      { receipt_date: "2026-10-07", reference: "CASH DEPOSIT BRANCH 12", amount: "300.00" },
    ]),
  ]);

  it("matches across punctuation and extra narration text", () => {
    expect(result.links[0].matchedLeft).toBe(2);
    expect(keysOf(result, "short_paid")).toEqual(["INV/2026/0002"]);
  });
  it("flags unapplied cash", () => {
    expect(keysOf(result, "unapplied_receipt")).toEqual(["CASH DEPOSIT BRANCH 12"]);
  });
  it("ages open invoices against the latest date in the files, not today", () => {
    expect(result.asOf).toBe("2026-11-30");
    expect(keysOf(result, "overdue")).toEqual(["INV/2026/0003"]);
  });
});

describe("fee validation through a lookup chain", () => {
  const T = "mkt-fee-rate-card";
  const result = run(T, [
    ds(T, "settlement", [
      { order_id: "A1", sku: "TSHIRT-1", settlement_date: "2026-10-10", principal: "200.00", commission: "-30.00", net_amount: "170" },
      { order_id: "A2", sku: "PHONE-9", settlement_date: "2026-10-10", principal: "1000.00", commission: "-80.00", net_amount: "920" },
      { order_id: "A3", sku: "MYSTERY", settlement_date: "2026-10-10", principal: "50.00", commission: "-5.00", net_amount: "45" },
    ]),
    ds(T, "catalog", [
      { sku: "tshirt-1", category: "Fashion" },
      { sku: "PHONE-9", category: "Electronics" },
      { sku: "MYSTERY", category: "Toys" },
    ]),
    ds(T, "rate_card", [
      { category: "FASHION", commission_pct: "12", fixed_fee: "0" },
      { category: "Electronics", commission_pct: "8", fixed_fee: "0" },
    ]),
  ]);

  it("recalculates fees from SKU → category → rate and flags overcharges", () => {
    // TSHIRT-1: charged 30, expected 200 * 12% = 24.
    expect(keysOf(result, "commission_overcharge")).toEqual(["TSHIRT-1"]);
    expect(result.exceptions.find((e) => e.check === "commission_overcharge")!.diff).toBe(6);
  });
  it("lists categories missing from the rate card", () => {
    expect(keysOf(result, "unknown_fee")).toEqual(["Toys"]);
  });
});

describe("fallback keys and optional files", () => {
  it("matches by order ID when the payment row has no invoice number", () => {
    const T = "mkt-b2b-payment-release";
    const result = run(T, [
      ds(T, "b2b_invoices", [{ invoice_no: "B-1", order_id: "O-1", invoice_date: "2026-10-01", invoice_amount: "1000" }]),
      ds(T, "payments", [{ invoice_no: "", order_id: "O-1", release_date: "2026-10-20", released_amount: "900", held_amount: "100", deduction_amount: "0" }]),
    ]);
    expect(result.links[0].matchedLeft).toBe(1);
    expect(check(result, "short_released").count).toBe(0);
    expect(keysOf(result, "on_hold")).toEqual(["B-1"]);
  });

  it("skips checks that need an optional file that wasn't uploaded", () => {
    const T = "mkt-returns-vs-invoiced";
    const result = run(T, [
      ds(T, "sales", [{ order_id: "1", sku: "X", invoice_date: "2026-10-01", invoice_amount: "100", qty: "1" }]),
      ds(T, "returns", [{ order_id: "1", sku: "X", return_date: "2026-10-05", refund_amount: "120", qty: "1" }]),
    ]);
    expect(check(result, "not_received")).toMatchObject({ status: "skipped" });
    expect(keysOf(result, "refund_exceeds_invoice")).toEqual(["1 / X"]);
  });
});

describe("PDC tracking and monthly totals", () => {
  it("separates due, upcoming and bounced cheques", () => {
    const T = "b2b-pdc-clearing";
    const result = run(
      T,
      [
        ds(T, "pdc_register", [
          { cheque_no: "000123", customer: "A", cheque_date: "2026-10-01", amount: "5000" },
          { cheque_no: "000124", customer: "B", cheque_date: "2026-10-03", amount: "2000" },
          { cheque_no: "000125", customer: "C", cheque_date: "2026-10-25", amount: "3000" },
        ]),
        ds(T, "bank", [
          { value_date: "2026-10-02", description: "CHQ DEPOSIT 123", reference: "CHQ 123", credit: "5000" },
          { value_date: "2026-10-09", description: "RETURNED CHEQUE 999 INSUFFICIENT FUNDS", reference: "999", debit: "1500" },
        ]),
      ],
      "2026-10-10",
    );
    expect(keysOf(result, "due_not_deposited")).toEqual(["000124"]);
    expect(keysOf(result, "upcoming")).toEqual(["000125"]);
    expect(check(result, "bounced").count).toBe(1);
  });

  it("compares ad deductions and invoices per month", () => {
    const T = "mkt-ads-deductions";
    const result = run(T, [
      ds(T, "settlement", [
        { settlement_date: "2026-10-05", principal: "0", other_fees: "-300", net_amount: "-300" },
        { settlement_date: "2026-10-20", principal: "0", other_fees: "-200", net_amount: "-200" },
      ]),
      ds(T, "ad_invoices", [{ invoice_no: "ADS-10", invoice_date: "2026-10-31", amount: "450" }]),
    ]);
    expect(keysOf(result, "deducted_no_invoice")).toEqual(["2026-10"]);
    expect(result.exceptions.find((e) => e.check === "deducted_no_invoice")!.diff).toBe(50);
  });
});

describe("Excel export", () => {
  it("writes filtered, sorted sheets with header filters and money formats", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { buildWorkbook } = await import("./excel");
    const { buildReport } = await import("@/lib/runs/view");
    const T = "b2b-customer-statement";
    const result = run(T, [
      ds(T, "our_ledger", [
        { doc_no: "INV-1", doc_date: "2026-10-01", debit: "100", credit: "0" },
        { doc_no: "INV-2", doc_date: "2026-10-02", debit: "250", credit: "0" },
        { doc_no: "INV-3", doc_date: "2026-10-03", debit: "75", credit: "0" },
      ]),
      ds(T, "their_statement", [
        { doc_no: "INV-1", credit: "100", debit: "0" },
        { doc_no: "INV-2", credit: "200", debit: "0" },
        { doc_no: "PAY-9", credit: "0", debit: "500" },
      ]),
    ]);
    const report = buildReport(getTemplate(T)!, { ...result, createdAt: "2026-10-04T00:00:00Z" });

    const bytes = await buildWorkbook(report, "exceptions", { sort: "key", dir: "asc", filters: { check: "missing_in_theirs" } });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer);
    const ws = wb.getWorksheet("Exceptions")!;
    expect(ws.autoFilter).toBeDefined();
    expect(ws.getRow(1).getCell(1).value).toBe("Check");
    expect(ws.rowCount).toBe(2); // header + INV-3 only
    expect(ws.getRow(2).getCell(3).value).toBe("INV-3");

    const all = new ExcelJS.Workbook();
    await all.xlsx.load((await buildWorkbook(report, "all", {})).buffer);
    expect(all.worksheets.map((w) => w.name)).toEqual(["Checks", "Exceptions", "Matching"]);
    expect(all.getWorksheet("Exceptions")!.rowCount).toBe(1 + result.totals.exceptions);
  });
});
