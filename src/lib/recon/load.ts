import Papa from "papaparse";
import { parseNumber, type DateFormat } from "@/lib/files/profile";
import type { RunFile } from "@/lib/runs/types";
import type { SourceSlot } from "@/lib/templates/types";

/** One uploaded row, read through the slot's mapping. */
export type Rec = {
  slot: string;
  /** Row number as the user sees it in the file (header is row 1). */
  rowNumber: number;
  raw: Record<string, string>;
  num: Record<string, number | undefined>;
  /** ISO yyyy-mm-dd. */
  date: Record<string, string | undefined>;
};

export type Dataset = { slot: SourceSlot; fileName: string; rows: Rec[]; currency?: string };

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const pad = (n: number) => String(n).padStart(2, "0");
const year = (y: number) => (y < 100 ? 2000 + y : y);

function valid(y: number, m: number, d: number): string | undefined {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100)) return undefined;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Reads a date cell into ISO using the column's detected (or user-confirmed) format. */
export function parseDate(raw: string, format: DateFormat | "DMY" | "MDY" | undefined): string | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s) ?? /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) {
    const [a, b, y] = [+m[1], +m[2], year(+m[3])];
    // GCC exports are overwhelmingly day-first, so that's the fallback for unconfirmed columns.
    return format === "MDY" ? valid(y, a, b) : valid(y, b, a);
  }
  m = /^(\d{1,2})[ -]([a-z]{3})[a-z]*[-, ]+(\d{2,4})/i.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return valid(year(+m[3]), MONTHS[m[2].toLowerCase()], +m[1]);
  m = /^([a-z]{3})[a-z]* (\d{1,2}),? (\d{4})/i.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return valid(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  return undefined;
}

/** `csv` is the slot's stored, normalized table (see src/lib/files/storage.ts). */
export function loadDataset(file: RunFile, slot: SourceSlot, csv: string): Dataset {
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: "greedy" });
  const mapped = slot.fields
    .map((f) => ({ field: f, column: file.mapping.fields[f.key]?.column ?? null }))
    .filter((m): m is { field: (typeof slot.fields)[number]; column: string } => m.column !== null);
  const formats = new Map(file.profile.columns.map((c) => [c.name, c.dateFormat]));

  const rows: Rec[] = parsed.data.map((row, i) => {
    const rec: Rec = { slot: slot.key, rowNumber: i + 2, raw: {}, num: {}, date: {} };
    for (const { field, column } of mapped) {
      const value = (row[column] ?? "").trim();
      rec.raw[field.key] = value;
      if (field.type === "money" || field.type === "number" || field.type === "percent") {
        rec.num[field.key] = parseNumber(value.replace(/%$/, ""));
      } else if (field.type === "date") {
        rec.date[field.key] = parseDate(value, file.mapping.dateFormats[column] ?? formats.get(column));
      }
    }
    return rec;
  });

  const currencyColumn = file.mapping.fields.currency?.column;
  const currency = file.mapping.currency ?? (currencyColumn ? rows.find((r) => r.raw.currency)?.raw.currency : undefined);
  return { slot, fileName: file.fileName, rows, currency };
}
