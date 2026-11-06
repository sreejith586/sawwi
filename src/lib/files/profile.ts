import { createHash } from "node:crypto";
import type { ParsedTable } from "./parse";

export type ColumnKind = "empty" | "number" | "date" | "id" | "text";

/** DMY/MDY are d/m/y-style dates; AMBIGUOUS means every day and month value is ≤ 12. */
export type DateFormat = "ISO" | "DMY" | "MDY" | "YMD" | "TEXT_MONTH" | "AMBIGUOUS";

export type ColumnProfile = {
  name: string;
  kind: ColumnKind;
  samples: string[];
  fillRate: number;
  distinctRatio: number;
  dateFormat?: DateFormat;
  hasDecimals?: boolean;
  hasNegatives?: boolean;
  currencyHints?: string[];
};

export type FileProfile = {
  rowCount: number;
  columns: ColumnProfile[];
  fingerprint: string;
};

const SAMPLE_ROWS = 2000;
// No word boundaries: exports often glue the code to the number ("AED250.00").
const CURRENCY_RE = /AED|SAR|KWD|QAR|BHD|OMR|USD|EUR|GBP|د\.إ|ر\.س|\$|€|£/gi;

/** Parses a money/number cell: handles thousands separators, currency marks, (123) and 123- negatives. */
export function parseNumber(raw: string): number | undefined {
  let s = raw.trim();
  if (!s) return undefined;
  s = s.replace(CURRENCY_RE, "").replace(/[\s ]/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (!/^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(n)) return undefined;
  return negative ? -n : n;
}

const DATE_PATTERNS: { re: RegExp; format: DateFormat | "PARTS" }[] = [
  { re: /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?( ?(Z|[+-]\d{2}:?\d{2}|[A-Z]{2,4}))?)?$/, format: "ISO" },
  { re: /^\d{4}[/.]\d{1,2}[/.]\d{1,2}( .*)?$/, format: "YMD" },
  { re: /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}( .*)?$/, format: "PARTS" },
  { re: /^\d{1,2}[ -](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[ -,]+\d{2,4}/i, format: "TEXT_MONTH" },
  { re: /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2},? \d{4}/i, format: "TEXT_MONTH" },
];

function detectDateFormat(values: string[]): DateFormat | undefined {
  let matched = 0;
  const formats = new Set<DateFormat>();
  let firstOver12 = false;
  let secondOver12 = false;
  for (const v of values) {
    const p = DATE_PATTERNS.find((d) => d.re.test(v));
    if (!p) continue;
    matched++;
    if (p.format === "PARTS") {
      const [a, b] = v.split(/[/.\- ]/).map(Number);
      if (a > 12) firstOver12 = true;
      if (b > 12) secondOver12 = true;
      formats.add("AMBIGUOUS");
    } else {
      formats.add(p.format);
    }
  }
  if (values.length === 0 || matched / values.length < 0.9) return undefined;
  if (formats.has("AMBIGUOUS")) {
    if (firstOver12 && !secondOver12) return "DMY";
    if (secondOver12 && !firstOver12) return "MDY";
    if (!firstOver12 && !secondOver12) return "AMBIGUOUS";
    return undefined; // both sides exceed 12: not a consistent date column
  }
  return [...formats][0];
}

export function profileColumn(name: string, values: string[]): ColumnProfile {
  const filled = values.filter((v) => v !== "");
  const distinct = new Set(filled);
  const samples = [...distinct].slice(0, 5);
  const base = {
    name,
    samples,
    fillRate: values.length ? filled.length / values.length : 0,
    distinctRatio: filled.length ? distinct.size / filled.length : 0,
  };
  if (filled.length === 0) return { ...base, kind: "empty" };

  const dateFormat = detectDateFormat(filled);
  if (dateFormat) return { ...base, kind: "date", dateFormat };

  const numbers = filled.map(parseNumber);
  const numericShare = numbers.filter((n) => n !== undefined).length / filled.length;
  if (numericShare >= 0.9) {
    const hasDecimals = filled.some((v) => /\.\d/.test(v));
    // Long digit strings, leading zeros or near-unique integers are identifiers, not amounts.
    const zeroPadded = filled.some((v) => /^0\d/.test(v));
    const longDigits = filled.every((v) => v.replace(/\D/g, "").length >= 9);
    const nearUnique = filled.length > 3 && base.distinctRatio > 0.98;
    if (!hasDecimals && (zeroPadded || longDigits || nearUnique)) return { ...base, kind: "id" };
    const currencyHints = [...new Set(filled.flatMap((v) => v.match(CURRENCY_RE) ?? []).map((c) => c.toUpperCase()))];
    return {
      ...base,
      kind: "number",
      hasDecimals,
      hasNegatives: numbers.some((n) => n !== undefined && n < 0),
      ...(currencyHints.length ? { currencyHints } : {}),
    };
  }

  const idLike = base.distinctRatio > 0.9 && filled.every((v) => v.length <= 40 && !/\s{2,}/.test(v) && /\d/.test(v));
  return { ...base, kind: idLike ? "id" : "text" };
}

export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Same report layout → same fingerprint, regardless of column order or the data inside.
 * This is the key for the saved-mapping cache, which skips both heuristics and the LLM.
 */
export function fingerprintHeaders(headers: string[]): string {
  const key = headers.map(normalizeHeader).sort().join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

export function profileTable(table: ParsedTable): FileProfile {
  const sample = table.rows.slice(0, SAMPLE_ROWS);
  return {
    rowCount: table.rows.length,
    fingerprint: fingerprintHeaders(table.headers),
    columns: table.headers.map((h, i) => profileColumn(h, sample.map((r) => r[i] ?? ""))),
  };
}
