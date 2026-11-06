import ExcelJS from "exceljs";

// Generic one-sheet Excel export for simple tables (mapping, file preview, column spec).
// Styled like the report exports in src/lib/recon/excel.ts: bold shaded header,
// frozen header row, header autofilter, money format with red negatives.

export type SheetColumn = { header: string; key: string; type?: "text" | "number" | "money" | "date"; width?: number };

const MONEY = "#,##0.00;[Red]-#,##0.00";
const NUMBER = "#,##0.##;[Red]-#,##0.##";

export async function tableWorkbook(opts: { sheetName: string; columns: SheetColumn[]; rows: Record<string, unknown>[] }): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Sawwi";
  const ws = wb.addWorksheet(opts.sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1");

  ws.columns = opts.columns.map((c) => {
    const longest = Math.max(c.header.length, ...opts.rows.slice(0, 500).map((r) => String(r[c.key] ?? "").length));
    return {
      header: c.header,
      key: c.key,
      width: c.width ?? Math.min(60, Math.max(10, longest + 2)),
      style: c.type === "money" ? { numFmt: MONEY } : c.type === "number" ? { numFmt: NUMBER } : c.type === "date" ? { numFmt: "dd-mmm-yyyy" } : {},
    };
  });

  for (const row of opts.rows) {
    ws.addRow(
      Object.fromEntries(
        opts.columns.map((c) => {
          const v = row[c.key];
          if (v === "" || v === null || v === undefined) return [c.key, null];
          if (c.type === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return [c.key, new Date(`${v.slice(0, 10)}T00:00:00Z`)];
          return [c.key, v];
        }),
      ),
    );
  }

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FF101828" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F4F7" } };
  header.border = { bottom: { style: "thin", color: { argb: "FFE4E7EC" } } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  if (opts.columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: opts.columns.length } };

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export function xlsxResponse(bytes: ArrayBuffer, fileName: string): Response {
  const safe = fileName.replace(/[^\w.-]+/g, "-");
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safe.endsWith(".xlsx") ? safe : `${safe}.xlsx`}"`,
      "Cache-Control": "no-store",
    },
  });
}
