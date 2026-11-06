import { describe, expect, it } from "vitest";
import { parseUpload, parseUploads, UnsupportedFileError } from "@/lib/files/parse";
import { profileTable } from "@/lib/files/profile";
import * as F from "./fixtures/make";
import { extractPdf, type LayoutMemory, type LayoutRecipe } from "./index";
import { invoiceChecks } from "./invoice";
import { groupLines, readTable, toWords } from "./layout";
import { cleanText, normalizeDigits, parseAmount } from "./text";
import type { TextItem } from "./types";
import { decodeZatcaQr, parseUblInvoice } from "./zatca";

const STATEMENT_HEADERS = ["Date", "Description", "Reference", "Debit", "Credit", "Balance"];

describe("text-layer bank statement", () => {
  it("reads rows, folds wrapped narration and keeps metadata apart (golden)", async () => {
    const table = await parseUpload("jan.pdf", await F.statementPdf({ opening: 10000, txns: F.JANUARY, printTotals: true }));
    expect(table.headers).toEqual(STATEMENT_HEADERS);
    expect(table.rows).toEqual([
      ["02/01/2026", "NOON PAYOUT 88231", "FT26002ABC", "", "2,500.00", "12,500.00"],
      ["03/01/2026", "POS PURCHASE OFFICE SUPPLIES MARINA BRANCH DUBAI", "", "350.75", "", "12,149.25"],
      ["05/01/2026", "AMAZON.AE SETTLEMENT", "FT26005XYZ", "", "1,200.00", "13,349.25"],
      ["07/01/2026", "BANK CHARGES", "", "26.25", "", "13,323.00"],
    ]);
    const info = table.pdf![0];
    expect(info).toMatchObject({ kind: "statement", method: "text", pages: 1, skipped: 3 });
    expect(Object.fromEntries(info.meta.map((m) => [m.label, m.value]))).toEqual({
      Issuer: "Gulf Example Bank PJSC",
      Account: "1012345678901",
      IBAN: "AE070331012345678901234",
      Period: "01/01/2026 – 31/01/2026",
      Currency: "AED",
      "Opening balance": "AED 10,000.00",
      "Closing balance": "AED 13,323.00",
    });
    expect(info.checks.map((c) => [c.id, c.ok])).toEqual([
      ["balance_equation", true],
      ["printed_totals", true],
      ["running_balance", true],
    ]);
  });

  it("profiles like any other upload: dates and amounts are typed", async () => {
    const table = await parseUpload("jan.pdf", await F.statementPdf({ opening: 10000, txns: F.JANUARY }));
    const kinds = Object.fromEntries(profileTable(table).columns.map((c) => [c.name, c.kind]));
    expect(kinds).toMatchObject({ Date: "date", Debit: "number", Credit: "number", Balance: "number" });
  });

  it("joins a multi-page statement: repeated headers, carried/brought forward and page footers are dropped", async () => {
    const table = await parseUpload("q1.pdf", await F.statementPdf({ opening: 5000, txns: F.QUARTER, rowsPerPage: 9 }));
    const info = table.pdf![0];
    expect(info.pages).toBe(3);
    expect(table.rows).toHaveLength(F.QUARTER.length);
    expect(table.rows.map((r) => r[0])).toEqual(F.QUARTER.map((t) => t.date));
    expect(table.rows.some((r) => /forward|page/i.test(r.join(" ")))).toBe(false);
    // Golden: first row, a wrapped row and the last row.
    expect(table.rows[0]).toEqual(["01/01/2026", "SUPPLIER PAYMENT 1000", "TT5000", "1,000.00", "", "4,000.00"]);
    expect(table.rows[1]).toEqual(["02/01/2026", "NOON PAYOUT 7001 SETTLEMENT REF NP-1", "", "", "2,003.25", "6,003.25"]);
    expect(table.rows[22]).toEqual(["23/03/2026", "NOON PAYOUT 7022", "", "", "2,071.50", "26,667.25"]);
    // Opening (page 1), 2 carried + 2 brought forward, closing (page 3), and 2 repeated headers.
    expect(info.skipped).toBe(8);
    expect(info.checks.every((c) => c.ok)).toBe(true);
    expect(info.meta.find((m) => m.label === "Closing balance")?.value).toBe("AED 26,667.25");
  });

  it("fails the balance checks when a printed balance is off", async () => {
    const table = await parseUpload("bad.pdf", await F.statementPdf({ opening: 10000, txns: F.JANUARY, misprint: { row: 1, by: 100 } }));
    const running = table.pdf![0].checks.find((c) => c.id === "running_balance")!;
    expect(running.ok).toBe(false);
    expect(running.detail).toBe("1 balance doesn't follow: row 2 shows AED 12,249.25, expected AED 12,149.25.");
  });

  it("reports a missing row once, then follows on from the printed balances", async () => {
    const pdf = await F.statementPdf({ opening: 10000, txns: F.JANUARY });
    const table = await parseUpload("gap.pdf", pdf);
    // Drop row 2 (the 350.75 debit) as if the extraction had missed it.
    const { buildStatement } = await import("./statement");
    const { groupLines: gl, readTable: rt, toWords: tw } = await import("./layout");
    const { loadPdf } = await import("./read");
    const doc = await loadPdf(pdf);
    const t = rt(gl(tw(doc.pages.flatMap((p) => p.items))))!;
    await doc.close();
    t.rows.splice(1, 1);
    const checks = buildStatement(t).checks;
    expect(table.rows).toHaveLength(4);
    expect(checks.find((c) => c.id === "running_balance")!.detail).toBe(
      "1 balance doesn't follow: row 2 shows AED 13,349.25, expected AED 13,700.00.",
    );
    expect(checks.find((c) => c.id === "balance_equation")!.ok).toBe(false);
  });
});

describe("invoices", () => {
  it("reads a text invoice as one row per invoice (golden) and checks lines, VAT and total", async () => {
    const pdf = await F.invoicePdf({ number: "INV-2026-0042", date: "15/01/2026", po: "PO-7781", lines: F.MOUSE_LINES });
    const table = await parseUpload("inv.pdf", pdf, { pdf: { countries: ["AE"] } });
    expect(table.rows).toEqual([
      ["INV-2026-0042", "15/01/2026", "Invoice", "Example Trading LLC", "100123456700003", "Example Retail FZE", "100987654300003", "PO-7781", "AED", "950.00", "47.50", "5", "997.50", "3"],
    ]);
    expect(table.pdf![0].checks.map((c) => [c.id, c.ok])).toEqual([
      ["lines_subtotal", true],
      ["vat_rate", true],
      ["total", true],
    ]);
  });

  it("reads invoice lines when the slot wants line detail (golden)", async () => {
    const pdf = await F.invoicePdf({ number: "INV-2026-0042", date: "15/01/2026", po: "PO-7781", lines: F.MOUSE_LINES });
    const table = await parseUpload("inv.pdf", pdf, { pdf: { grain: "line" } });
    expect(table.rows.map((r) => r.slice(4, 10))).toEqual([
      ["1", "Wireless Mouse", "SKU-001", "10", "25.00", "250.00"],
      ["2", "USB-C Cable 1m", "SKU-002", "20", "12.50", "250.00"],
      ["3", "Laptop Stand Aluminium", "SKU-003", "5", "90.00", "450.00"],
    ]);
  });

  it("flags VAT that isn't rate × net, and a rate that doesn't fit the workspace's country", async () => {
    const wrong = await F.invoicePdf({ number: "INV-9", date: "15/01/2026", lines: F.MOUSE_LINES, vatOverride: 52.5 });
    const vat = (await parseUpload("x.pdf", wrong, { pdf: { countries: ["AE"] } })).pdf![0].checks.find((c) => c.id === "vat_rate")!;
    expect(vat.ok).toBe(false);
    expect(vat.detail).toContain("5% of AED 950.00 is AED 47.50");

    const ksaRate = invoiceChecks({ type: "Invoice", subtotal: 100, vat: 5, total: 105, lines: [] }, ["SA"]).find((c) => c.id === "vat_rate")!;
    expect(ksaRate).toMatchObject({ ok: false });
    expect(ksaRate.detail).toContain("set up for 15%");
  });

  it("reads the ZATCA UBL XML embedded in a PDF/A-3 invoice (golden)", async () => {
    const table = await parseUpload("zatca.pdf", await F.zatcaPdf(), { pdf: { grain: "line", countries: ["SA"] } });
    expect(table.pdf![0]).toMatchObject({ kind: "invoice", method: "zatca_xml" });
    expect(table.rows).toEqual([
      ["SME00062", "2026-01-20", "شركة المثال للتجارة & Co", "PO-4410", "1", "قهوة عربية 500g", "COF-500", "4", "75.00", "300.00", "15", "45.00", "345.00", "SAR"],
      ["SME00062", "2026-01-20", "شركة المثال للتجارة & Co", "PO-4410", "2", "Dates Gift Box", "DAT-01", "2", "50.00", "100.00", "15", "15.00", "115.00", "SAR"],
    ]);
    expect(table.pdf![0].checks.every((c) => c.ok)).toBe(true);
  });

  it("falls back to the ZATCA QR (TLV) when there's no XML and no text", async () => {
    const table = await parseUpload("qr.pdf", await F.zatcaPdf({ attachXml: false, text: false }));
    expect(table.pdf![0].method).toBe("zatca_qr");
    expect(table.rows[0]).toEqual(["", "2026-01-20", "Invoice", "Example Trading Co", "300075588700003", "", "", "", "SAR", "400.00", "60.00", "", "460.00", "0"]);
  });

  it("decodes ZATCA TLV and parses credit notes as negative", () => {
    expect(decodeZatcaQr(F.ZATCA_QR)).toEqual({ seller: "Example Trading Co", vatNumber: "300075588700003", timestamp: "2026-01-20T16:17:44Z", total: 460, vat: 60 });
    expect(decodeZatcaQr("not a payload")).toBeUndefined();
    const credit = parseUblInvoice(F.ZATCA_XML.replace(">388<", ">381<"))!;
    expect(credit.type).toBe("Credit note");
  });

  it("puts several invoice PDFs into one slot, one row each, traced to their file", async () => {
    const a = await F.invoicePdf({ number: "INV-1", date: "01/01/2026", lines: F.MOUSE_LINES.slice(0, 1) });
    const b = await F.invoicePdf({ number: "INV-2", date: "02/01/2026", lines: F.MOUSE_LINES.slice(1) });
    const table = await parseUploads([
      { name: "a.pdf", data: a },
      { name: "b.pdf", data: b },
    ]);
    expect(table.headers[0]).toBe("Source file");
    expect(table.rows.map((r) => [r[0], r[1], r[table.headers.indexOf("Total incl. VAT")]])).toEqual([
      ["a.pdf", "INV-1", "262.50"],
      ["b.pdf", "INV-2", "735.00"],
    ]);
    expect(table.pdf).toHaveLength(2);
  });
});

describe("refused PDFs", () => {
  it("refuses a scanned (image-only) PDF with a clear message", async () => {
    await expect(parseUpload("scan.pdf", await F.scannedPdf())).rejects.toThrow(
      new UnsupportedFileError("scan.pdf: This PDF is a scanned image. Export it as CSV/Excel, or upload a text PDF."),
    );
  });

  it("refuses a password-protected PDF", async () => {
    await expect(parseUpload("locked.pdf", F.passwordPdf())).rejects.toThrow(/password-protected/);
  });

  it("refuses a file that isn't a PDF", async () => {
    await expect(parseUpload("broken.pdf", new TextEncoder().encode("%PDF-1.4 nothing here"))).rejects.toThrow(UnsupportedFileError);
  });
});

describe("layout memory", () => {
  it("learns a statement layout, then reuses it for the next statement from the same bank", async () => {
    const saved = new Map<string, LayoutRecipe>();
    const layouts: LayoutMemory = {
      find: (issuer) => [...saved.values()].filter((r) => r.issuerKey === issuer),
      save: (r) => void saved.set(r.fingerprint, r),
    };
    const first = await extractPdf("jan.pdf", await F.statementPdf({ opening: 10000, txns: F.JANUARY }), { layouts });
    expect(first.info.layout).toBe("learned");
    expect(saved.size).toBe(1);
    const recipe = [...saved.values()][0];
    expect(recipe.columns.map((c) => c.role)).toEqual(["date", "description", "reference", "debit", "credit", "balance"]);

    const second = await extractPdf("feb.pdf", await F.statementPdf({ opening: 13323, txns: F.QUARTER.slice(0, 6) }), { layouts });
    expect(second.info.layout).toBe("remembered");
    expect(second.headers).toEqual(first.headers);
    expect(saved.size).toBe(1);
  });
});

describe("Arabic and RTL text", () => {
  it("normalises Arabic-Indic digits and separators", () => {
    expect(normalizeDigits("٠١/٠٢/٢٠٢٦")).toBe("01/02/2026");
    expect(normalizeDigits("١٬٢٥٠٫٥٠")).toBe("1,250.50");
    expect(normalizeDigits("۱۲۳")).toBe("123");
    expect(cleanText("‏١٬٠٠٠٫٠٠‎")).toBe("1,000.00");
    expect(parseAmount("١٬٢٥٠٫٥٠")).toBe(1250.5);
    expect(parseAmount("1,234.50 DR")).toBe(-1234.5);
    expect(parseAmount("(10.00)")).toBe(-10);
  });

  it("reads a right-to-left Arabic statement table in reading order", () => {
    // pdf.js gives logical-order strings with positions; columns run right to left.
    const at = (str: string, x: number, y: number, rtl = true): TextItem => ({ str, x, y, w: str.length * 5, h: 9, page: 1, rtl });
    const items: TextItem[] = [
      at("بنك المثال", 450, 40),
      at("الرصيد", 40, 100),
      at("دائن", 140, 100),
      at("مدين", 240, 100),
      at("البيان", 380, 100),
      at("التاريخ", 500, 100),
      at("١٠٬٠٠٠٫٠٠", 40, 115, false),
      at("الرصيد الافتتاحي", 360, 115),
      at("٠١/٠١/٢٠٢٦", 500, 115, false),
      at("١٢٬٥٠٠٫٠٠", 40, 130, false),
      at("٢٬٥٠٠٫٠٠", 140, 130, false),
      at("تحويل من نون", 360, 130),
      at("٠٢/٠١/٢٠٢٦", 500, 130, false),
    ];
    const t = readTable(groupLines(toWords(items)))!;
    expect(t.columns.map((c) => [c.name, c.role])).toEqual([
      ["التاريخ", "date"],
      ["البيان", "description"],
      ["مدين", "debit"],
      ["دائن", "credit"],
      ["الرصيد", "balance"],
    ]);
    expect(t.rows.map((r) => r.cells)).toEqual([["02/01/2026", "تحويل من نون", "", "2,500.00", "12,500.00"]]);
    expect(t.specials).toHaveLength(1);
    expect(t.specials[0].kind).toBe("opening");
  });
});
