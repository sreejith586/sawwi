import ExcelJS from "exceljs";
import type { ReportView } from "@/lib/runs/view";
import type { Dataset } from "./load";
import { applyQuery, type TableQuery } from "./table";

// Excel exports for every report table: header filters, frozen header row, money
// formats, and the same color coding as the screen (red = money at risk, amber =
// needs follow-up, green = reconciled).

const COLORS = { high: "FFB42318", medium: "FFB54708", info: "FF175CD3", ok: "FF067647", header: "FFF2F4F7", border: "FFE4E7EC" };
const MONEY = "#,##0.00;[Red]-#,##0.00";

export type ExportTable = "checks" | "exceptions" | "links" | "all";

export const CHECK_SEARCH = ["label", "description"] as const;
export const EXCEPTION_SEARCH = ["key", "checkLabel", "note", "leftRows", "rightRows"] as const;

function styleSheet(ws: ExcelJS.Worksheet) {
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FF101828" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.header } };
  header.border = { bottom: { style: "thin", color: { argb: COLORS.border } } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  if (ws.columnCount > 0 && ws.rowCount > 0) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

function addChecks(wb: ExcelJS.Workbook, report: ReportView, query: TableQuery) {
  const ws = wb.addWorksheet("Checks");
  ws.columns = [
    { header: "Check", key: "label", width: 36 },
    { header: "Severity", key: "severity", width: 11 },
    { header: "Status", key: "status", width: 12 },
    { header: "Exceptions", key: "count", width: 12 },
    { header: `Value${report.currency ? ` (${report.currency})` : ""}`, key: "value", width: 16, style: { numFmt: MONEY } },
    { header: "What it checks", key: "description", width: 70 },
  ];
  for (const c of applyQuery(report.checks, query, [...CHECK_SEARCH])) {
    const row = ws.addRow({ ...c, status: c.status === "done" ? "Checked" : c.reason ?? c.status });
    const color = c.status !== "done" ? undefined : c.count === 0 ? COLORS.ok : COLORS[c.severity];
    if (color) {
      row.getCell("count").font = { bold: true, color: { argb: color } };
      row.getCell("severity").font = { color: { argb: color } };
    }
  }
  styleSheet(ws);
}

function rowDetails(datasets: Map<string, Dataset> | undefined, file: string | undefined, rowsText: string | undefined) {
  if (!datasets || !file || !rowsText) return "";
  const ds = [...datasets.values()].find((d) => d.slot.label === file);
  const first = Number(rowsText.split(",")[0]);
  const rec = ds?.rows.find((r) => r.rowNumber === first);
  if (!ds || !rec) return "";
  return ds.slot.fields
    .filter((f) => rec.raw[f.key])
    .map((f) => `${f.label}: ${rec.raw[f.key]}`)
    .join(" · ");
}

function addExceptions(wb: ExcelJS.Workbook, report: ReportView, query: TableQuery, datasets?: Map<string, Dataset>) {
  const ws = wb.addWorksheet("Exceptions");
  const cur = report.currency ? ` (${report.currency})` : "";
  ws.columns = [
    { header: "Check", key: "checkLabel", width: 30 },
    { header: "Severity", key: "severity", width: 10 },
    { header: "Key", key: "key", width: 24 },
    { header: `Left value${cur}`, key: "leftValue", width: 15, style: { numFmt: MONEY } },
    { header: `Right value${cur}`, key: "rightValue", width: 15, style: { numFmt: MONEY } },
    { header: `Difference${cur}`, key: "diff", width: 15, style: { numFmt: MONEY } },
    { header: `At risk${cur}`, key: "value", width: 15, style: { numFmt: MONEY } },
    { header: "Note", key: "note", width: 30 },
    { header: "Left file", key: "leftFile", width: 26 },
    { header: "Left rows", key: "leftRows", width: 12 },
    { header: "Left details", key: "leftDetails", width: 60 },
    { header: "Right file", key: "rightFile", width: 26 },
    { header: "Right rows", key: "rightRows", width: 12 },
    { header: "Right details", key: "rightDetails", width: 60 },
  ];
  for (const e of applyQuery(report.exceptions, query, [...EXCEPTION_SEARCH])) {
    const row = ws.addRow({
      ...e,
      leftDetails: rowDetails(datasets, e.leftFile, e.leftRows),
      rightDetails: rowDetails(datasets, e.rightFile, e.rightRows),
    });
    row.getCell("severity").font = { color: { argb: COLORS[e.severity] } };
    if (e.diff) row.getCell("diff").font = { bold: true, color: { argb: COLORS.high } };
    if (e.value) row.getCell("value").font = { color: { argb: COLORS[e.severity] } };
  }
  styleSheet(ws);
}

function addLinks(wb: ExcelJS.Workbook, report: ReportView) {
  const ws = wb.addWorksheet("Matching");
  ws.columns = [
    { header: "Left file", key: "leftLabel", width: 32 },
    { header: "Right file", key: "rightLabel", width: 32 },
    { header: "Left rows", key: "leftRows", width: 11 },
    { header: "Matched left", key: "matchedLeft", width: 13 },
    { header: "Right rows", key: "rightRows", width: 11 },
    { header: "Matched right", key: "matchedRight", width: 14 },
    { header: "Match rate", key: "rate", width: 11, style: { numFmt: "0.0%" } },
    { header: "Left total", key: "leftTotal", width: 15, style: { numFmt: MONEY } },
    { header: "Right total", key: "rightTotal", width: 15, style: { numFmt: MONEY } },
  ];
  for (const l of report.links) {
    const rate = l.leftRows ? l.matchedLeft / l.leftRows : 0;
    const row = ws.addRow({ ...l, rate: l.skipped ? null : rate });
    row.getCell("rate").font = { bold: true, color: { argb: rate >= 0.95 ? COLORS.ok : rate >= 0.8 ? COLORS.medium : COLORS.high } };
  }
  styleSheet(ws);
}

export async function buildWorkbook(
  report: ReportView,
  table: ExportTable,
  query: TableQuery,
  datasets?: Map<string, Dataset>,
): Promise<Uint8Array<ArrayBuffer>> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Sawwina";
  wb.created = new Date(report.ranAt);
  if (table === "checks" || table === "all") addChecks(wb, report, table === "all" ? {} : query);
  if (table === "exceptions" || table === "all") addExceptions(wb, report, table === "all" ? {} : query, datasets);
  if (table === "links" || table === "all") addLinks(wb, report);
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
