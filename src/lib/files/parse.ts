import ExcelJS from "exceljs";
import Papa from "papaparse";
import { extractPdf, PdfInputError, type PdfFileInfo, type PdfOptions } from "@/lib/pdf";

export type ParsedTable = {
  headers: string[];
  rows: string[][];
  /** Set for PDFs: how each file was read, its statement/invoice details and pre-match checks. */
  pdf?: PdfFileInfo[];
};

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const SUPPORTED_EXTENSIONS = [".csv", ".tsv", ".txt", ".xlsx", ".pdf"];
/** Several files can go into one slot (e.g. a month of supplier invoices). */
export const MAX_FILES_PER_SLOT = 50;
export const SOURCE_FILE_COLUMN = "Source file";

export class UnsupportedFileError extends Error {}

export type ParseOptions = { pdf?: PdfOptions };

export async function parseUpload(fileName: string, data: Uint8Array, options: ParseOptions = {}): Promise<ParsedTable> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf") || isPdf(data)) {
    try {
      const { headers, rows, info } = await extractPdf(fileName, data, options.pdf);
      return { headers, rows, pdf: [info] };
    } catch (error) {
      if (error instanceof PdfInputError) throw new UnsupportedFileError(`${fileName}: ${error.message}`);
      throw error;
    }
  }
  if (lower.endsWith(".xlsx")) return toTable(await readXlsx(data));
  if (lower.endsWith(".xls")) {
    throw new UnsupportedFileError("Old .xls files aren't supported yet. Save the file as .xlsx or .csv and upload again.");
  }
  if (SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) return toTable(readDelimited(decodeText(data)));
  throw new UnsupportedFileError("Upload a CSV, TSV, Excel (.xlsx) or PDF file.");
}

const isPdf = (data: Uint8Array) => data.length > 4 && data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46;

/**
 * Several files into one slot become one table: columns are the union in first-seen order,
 * with a "Source file" column first so every row can be traced back.
 */
export async function parseUploads(files: { name: string; data: Uint8Array }[], options: ParseOptions = {}): Promise<ParsedTable> {
  if (files.length === 1) return parseUpload(files[0].name, files[0].data, options);
  if (files.length > MAX_FILES_PER_SLOT) throw new UnsupportedFileError(`Upload up to ${MAX_FILES_PER_SLOT} files at once into one slot.`);
  const tables = [];
  for (const f of files) tables.push({ name: f.name, table: await parseUpload(f.name, f.data, options) });
  const headers = [SOURCE_FILE_COLUMN, ...new Set(tables.flatMap((t) => t.table.headers))];
  const rows = tables.flatMap(({ name, table }) => {
    const at = headers.map((h) => table.headers.indexOf(h));
    return table.rows.map((r) => headers.map((_, i) => (i === 0 ? name : at[i] >= 0 ? (r[at[i]] ?? "") : "")));
  });
  const pdf = tables.flatMap((t) => t.table.pdf ?? []);
  return { headers, rows, ...(pdf.length ? { pdf } : {}) };
}

/** UTF-8 first; fall back to Windows-1256 (Arabic), which older GCC ERP exports often use. */
export function decodeText(data: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(data);
  const broken = (utf8.match(/�/g) ?? []).length;
  const text = broken > 5 && broken / utf8.length > 0.001 ? new TextDecoder("windows-1256").decode(data) : utf8;
  return text.replace(/^﻿/, "");
}

function readDelimited(text: string): string[][] {
  const result = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  return result.data;
}

async function readXlsx(data: Uint8Array): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  // Use the sheet with the most rows: exports often have a cover or summary sheet first.
  const sheet = [...workbook.worksheets].sort((a, b) => b.actualRowCount - a.actualRowCount)[0];
  if (!sheet) return [];
  const out: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    for (let c = 1; c <= sheet.columnCount; c++) values.push(cellToString(row.getCell(c).value));
    out.push(values);
  });
  return out;
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // Excel dates become ISO so date format is never ambiguous.
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 19).replace("T", " ");
  }
  if (typeof value === "object") {
    if ("result" in value) return cellToString(value.result as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("text" in value) return String(value.text);
    if ("error" in value) return "";
  }
  return String(value).trim();
}

/**
 * Finds the header row (skipping title/summary rows above it), names blank or
 * duplicate headers, and squares up ragged rows.
 */
export function toTable(raw: string[][]): ParsedTable {
  const rows = raw.map((r) => r.map((c) => (c ?? "").toString().trim()));
  const width = Math.max(0, ...rows.slice(0, 50).map(nonEmptyCount));
  if (width === 0) return { headers: [], rows: [] };

  const headerIndex = Math.max(
    0,
    rows.slice(0, 15).findIndex((r) => {
      const cells = r.filter((c) => c !== "");
      if (cells.length < Math.max(2, Math.ceil(width * 0.6))) return false;
      const textual = cells.filter((c) => !/^[-+]?[\d.,\s%]+$/.test(c)).length;
      return textual / cells.length >= 0.7;
    }),
  );

  const headerRow = rows[headerIndex];
  const lastUsed = Math.max(...rows.slice(headerIndex, headerIndex + 200).map(lastNonEmpty)) + 1;
  const seen = new Map<string, number>();
  const headers = Array.from({ length: lastUsed }, (_, i) => {
    const base = headerRow[i] || `Column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });

  const body = rows
    .slice(headerIndex + 1)
    .filter((r) => nonEmptyCount(r) > 0)
    .map((r) => headers.map((_, i) => r[i] ?? ""));

  return { headers, rows: body };
}

const nonEmptyCount = (r: string[]) => r.filter((c) => c !== "").length;
const lastNonEmpty = (r: string[]) => {
  for (let i = r.length - 1; i >= 0; i--) if (r[i] !== "") return i;
  return -1;
};
