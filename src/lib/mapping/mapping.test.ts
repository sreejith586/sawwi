import { describe, expect, it } from "vitest";
import { decodeText, toTable } from "@/lib/files/parse";
import { fingerprintHeaders, parseNumber, profileColumn, profileTable } from "@/lib/files/profile";
import { getTemplate } from "@/lib/templates/catalog";
import { assign, AUTO_ACCEPT, scoreCandidates } from "./heuristic";
import { checkKeyOverlap } from "./keycheck";

// Synthetic samples shaped like real exports (headers only resemble the platforms; data is made up).
const MAGENTO2 = [
  ["ID", "Purchase Point", "Purchase Date", "Bill-to Name", "Grand Total (Base)", "Grand Total (Purchased)", "Status", "Payment Method", "Total Refunded"],
  ["000000101", "Main Website", "2026-10-01 10:12:00", "Aisha K", "250.00", "250.00", "complete", "Cash On Delivery", "0.00"],
  ["000000102", "Main Website", "2026-10-02 14:40:00", "Omar S", "1,120.50", "1,120.50", "processing", "Checkout.com", ""],
  ["000000103", "Main Website", "2026-10-03 09:05:00", "Lina M", "89.00", "89.00", "closed", "Tabby", "89.00"],
];
const MAGENTO1 = [
  ["Order #", "Purchased On", "Bill to Name", "Ship to Name", "G.T. (Base)", "G.T. (Purchased)", "Status"],
  ["100000201", "Oct 1, 2026 10:12:00 AM", "Aisha K", "Aisha K", "AED250.00", "AED250.00", "Complete"],
  ["100000202", "Oct 2, 2026 2:40:00 PM", "Omar S", "Omar S", "AED1,120.50", "AED1,120.50", "Processing"],
];
const SHOPIFY = [
  ["Name", "Email", "Financial Status", "Paid at", "Currency", "Subtotal", "Total", "Refunded Amount", "Created at", "Payment Method"],
  ["#1001", "a@x.com", "paid", "2026-10-01 10:12:00 +0400", "AED", "240.00", "250.00", "0.00", "2026-10-01 10:11:00 +0400", "Tap"],
  ["#1002", "b@x.com", "refunded", "2026-10-02 14:40:00 +0400", "AED", "80.00", "89.00", "89.00", "2026-10-02 14:39:00 +0400", "Tabby"],
];

const ordersSlot = getTemplate("web-orders-vs-gateway")!.sources.find((s) => s.key === "orders")!;

function autoMapped(raw: string[][]) {
  const profile = profileTable(toTable(raw));
  const best = assign(scoreCandidates(ordersSlot.fields, profile.columns));
  return Object.fromEntries([...best].filter(([, c]) => c.score >= AUTO_ACCEPT).map(([k, c]) => [k, c.column]));
}

describe("file parsing", () => {
  it("skips title rows above the real header", () => {
    const t = toTable([["Settlement report"], ["Period: Oct 2026", ""], ...MAGENTO2]);
    expect(t.headers[0]).toBe("ID");
    expect(t.rows).toHaveLength(3);
  });

  it("names blank and duplicate headers", () => {
    const t = toTable([["Amount", "", "Amount"], ["1", "2", "3"], ["4", "5", "6"]]);
    expect(t.headers).toEqual(["Amount", "Column 2", "Amount (2)"]);
  });

  it("strips a UTF-8 BOM", () => {
    expect(decodeText(new TextEncoder().encode("﻿Order,Total"))).toBe("Order,Total");
  });
});

describe("column profiling", () => {
  it("parses GCC money formats", () => {
    expect(parseNumber("AED1,120.50")).toBe(1120.5);
    expect(parseNumber("(45.00)")).toBe(-45);
    expect(parseNumber("12.5-")).toBe(-12.5);
    expect(parseNumber("SAR 99")).toBe(99);
    expect(parseNumber("ABC-1")).toBeUndefined();
  });

  it("detects date formats, including ambiguous day/month", () => {
    expect(profileColumn("d", ["2026-10-01", "2026-10-02"]).dateFormat).toBe("ISO");
    expect(profileColumn("d", ["25/10/2026", "03/11/2026"]).dateFormat).toBe("DMY");
    expect(profileColumn("d", ["10/25/2026", "11/03/2026"]).dateFormat).toBe("MDY");
    expect(profileColumn("d", ["03/04/2026", "05/06/2026"]).dateFormat).toBe("AMBIGUOUS");
  });

  it("treats zero-padded numbers as identifiers, not amounts", () => {
    expect(profileColumn("ID", ["000000101", "000000102", "000000103", "000000104"]).kind).toBe("id");
    expect(profileColumn("Total", ["250.00", "1,120.50", "89.00"]).kind).toBe("number");
  });

  it("fingerprints a layout independent of column order and data", () => {
    expect(fingerprintHeaders(["Order #", "Total"])).toBe(fingerprintHeaders(["total", "ORDER #"]));
    expect(fingerprintHeaders(["Order #", "Total"])).not.toBe(fingerprintHeaders(["Order #", "Net"]));
  });
});

describe("heuristic mapping", () => {
  it("maps a Magento 2 order export without AI", () => {
    const m = autoMapped(MAGENTO2);
    expect(m.order_id).toBe("ID");
    expect(m.order_date).toBe("Purchase Date");
    expect(m.order_total).toBe("Grand Total (Purchased)");
    expect(m.order_status).toBe("Status");
    expect(m.refunded_amount).toBe("Total Refunded");
  });

  it("maps a Magento 1 order grid export without AI", () => {
    const m = autoMapped(MAGENTO1);
    expect(m.order_id).toBe("Order #");
    expect(m.order_date).toBe("Purchased On");
    expect(m.order_total).toBe("G.T. (Purchased)");
  });

  it("maps a Shopify orders export", () => {
    const m = autoMapped(SHOPIFY);
    expect(m.order_total).toBe("Total");
    expect(m.currency).toBe("Currency");
    expect(m.order_date).toBe("Created at");
    expect(m.order_status).toBe("Financial Status");
  });
});

describe("cross-file key check", () => {
  it("suggests ignoring symbols when IDs differ only by format", () => {
    const left = ["#1001", "#1002", "#1003", "#1004"];
    const right = ["1001", "1002", "1003", "9999"];
    const r = checkKeyOverlap(left, right, ["trim", "upper"]);
    expect(r.overlap).toBe(0);
    expect(r.suggestion?.normalizers).toContain("strip_non_alnum");
    expect(r.suggestion?.leftExample).toBe("#1001");
    expect(r.suggestion?.rightExample).toBe("1001");
  });

  it("handles zero-padded IDs", () => {
    const r = checkKeyOverlap(["000000101", "000000102"], ["101", "102"], ["trim"]);
    expect(r.suggestion?.normalizers).toContain("strip_leading_zeros");
  });

  it("stays quiet when keys already line up", () => {
    const r = checkKeyOverlap(["A1", "A2"], ["a1", "a2"], ["trim", "upper"]);
    expect(r.overlap).toBe(1);
    expect(r.suggestion).toBeUndefined();
  });
});

describe("contains matching", () => {
  it("finds invoice numbers inside bank narrations", async () => {
    const { containmentOverlap } = await import("./keycheck");
    const invoices = ["INV/2026/0001", "INV/2026/0002", "INV/2026/0003", "INV/2026/0004"];
    const narrations = ["INWARD TT CLIENT 1 INV/2026/0002", "TT REF INV-2026-0003 PAYMENT", "CASH DEPOSIT"];
    expect(containmentOverlap(invoices, narrations, ["upper", "strip_non_alnum"])).toBe(0.5);
  });
});
