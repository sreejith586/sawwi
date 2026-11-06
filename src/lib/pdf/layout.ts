import { cleanText, DATE_TOKEN_RE, normalizeDigits, parseAmount, stripBidi } from "./text";
import type { ColumnRole, LayoutColumn, LayoutRecipe, TextItem } from "./types";

// Text-layer table reading, all in code: words → lines (by y) → columns (by the x-bands
// of a detected header line) → rows, with wrapped narration folded into the row above.

export type Word = { text: string; x0: number; x1: number; y: number; h: number; page: number; rtl: boolean };
export type Line = { page: number; y: number; h: number; words: Word[]; text: string };

const ARABIC = /[؀-ۿ]/;

/** Splits pdf.js text items into words, spreading the item's width across its characters. */
export function toWords(items: TextItem[]): Word[] {
  const out: Word[] = [];
  for (const it of items) {
    const s = normalizeDigits(stripBidi(it.str));
    if (!s.trim()) continue;
    const n = s.length;
    for (const m of s.matchAll(/\S+/g)) {
      const a = m.index!;
      const b = a + m[0].length;
      const rtl = it.rtl ?? ARABIC.test(s);
      const x0 = it.x + (it.w * (rtl ? n - b : a)) / n;
      const x1 = it.x + (it.w * (rtl ? n - a : b)) / n;
      out.push({ text: m[0], x0, x1, y: it.y, h: it.h || 8, page: it.page, rtl: ARABIC.test(m[0]) });
    }
  }
  return out;
}

/**
 * Joins words in reading order (a basic bidi pass): the line runs right to left when most
 * words are Arabic, and runs of the other direction keep their own order inside it.
 */
export function joinWords(words: Word[]): string {
  const sorted = [...words].sort((a, b) => a.x0 - b.x0);
  const rtlLine = sorted.filter((w) => w.rtl).length > sorted.length / 2;
  const seq = rtlLine ? sorted.reverse() : sorted;
  const out: Word[] = [];
  for (let i = 0; i < seq.length; ) {
    let j = i;
    while (j < seq.length && seq[j].rtl === seq[i].rtl) j++;
    const run = seq.slice(i, j);
    out.push(...(seq[i].rtl !== rtlLine ? run.reverse() : run));
    i = j;
  }
  return out.map((w) => w.text).join(" ");
}

export function groupLines(words: Word[]): Line[] {
  const byPage = new Map<number, Word[]>();
  for (const w of words) byPage.set(w.page, [...(byPage.get(w.page) ?? []), w]);
  const lines: Line[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const sorted = byPage.get(page)!.sort((a, b) => a.y - b.y || a.x0 - b.x0);
    let cur: Line | undefined;
    for (const w of sorted) {
      if (cur && Math.abs(w.y - cur.y) <= 0.45 * Math.max(w.h, cur.h)) cur.words.push(w);
      else {
        cur = { page, y: w.y, h: w.h, words: [w], text: "" };
        lines.push(cur);
      }
    }
  }
  for (const l of lines) {
    l.words.sort((a, b) => a.x0 - b.x0);
    l.text = joinWords(l.words);
  }
  return lines;
}

/** Runs of words separated by more than a normal word space. */
export function clusters(line: Line): Word[][] {
  const out: Word[][] = [];
  for (const w of line.words) {
    const last = out[out.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && w.x0 - prev.x1 <= Math.max(0.6 * w.h, 2.5)) last.push(w);
    else out.push([w]);
  }
  return out;
}

// ─── Header vocabulary ────────────────────────────────────────────────────

const VOCAB: [ColumnRole, string[]][] = [
  ["value_date", ["value date", "val date", "val. date", "تاريخ القيمة", "تاريخ الاستحقاق"]],
  ["date", ["date", "txn date", "tran date", "trans date", "transaction date", "posting date", "post date", "booking date", "invoice date", "order date", "التاريخ", "تاريخ", "تاريخ العملية", "تاريخ الحركة"]],
  ["description", ["description", "narration", "narrative", "details", "transaction details", "particulars", "remarks", "transaction description", "item", "item description", "description of goods", "goods / services", "product", "service", "البيان", "الوصف", "التفاصيل", "تفاصيل العملية", "الصنف"]],
  ["reference", ["reference", "ref", "ref no", "ref. no", "ref.", "reference no", "cheque no", "chq no", "chq/ref no", "chq / ref no", "transaction ref", "document no", "المرجع", "رقم المرجع", "رقم الشيك"]],
  ["debit", ["debit", "debits", "withdrawal", "withdrawals", "dr", "debit amount", "money out", "paid out", "مدين", "المدين", "سحب", "السحب", "السحوبات"]],
  ["credit", ["credit", "credits", "deposit", "deposits", "cr", "credit amount", "money in", "paid in", "دائن", "الدائن", "إيداع", "الإيداع", "الإيداعات"]],
  ["balance", ["balance", "running balance", "available balance", "book balance", "الرصيد"]],
  ["amount", ["amount", "transaction amount", "txn amount", "المبلغ"]],
  ["qty", ["qty", "qty.", "quantity", "units", "الكمية"]],
  ["unit_price", ["unit price", "price", "rate", "unit cost", "unit rate", "سعر الوحدة", "السعر"]],
  ["sku", ["sku", "item code", "code", "product code", "part no", "item no", "barcode", "رمز الصنف", "الرمز"]],
  ["net", ["net amount", "taxable amount", "amount excl vat", "amount excl. vat", "excl. vat", "excl vat", "net", "line amount", "المبلغ الخاضع للضريبة", "المبلغ قبل الضريبة"]],
  ["vat_rate", ["vat %", "vat%", "vat rate", "tax %", "tax rate", "rate %", "نسبة الضريبة"]],
  ["vat", ["vat", "vat amount", "tax", "tax amount", "مبلغ الضريبة", "ضريبة القيمة المضافة", "الضريبة"]],
  ["total", ["total", "line total", "amount incl vat", "amount incl. vat", "total incl. vat", "total incl vat", "gross amount", "gross", "الإجمالي", "المجموع"]],
  [
    "other",
    ["order id", "order no", "order number", "invoice no", "invoice number", "fee", "fees", "commission", "payout", "status", "type", "currency", "channel", "shipment", "awb", "s.no", "sr", "sr.", "#", "no", "no."],
  ],
];

const ROLE_BY_PHRASE = new Map(VOCAB.flatMap(([role, phrases]) => phrases.map((p) => [p, role] as const)));

export function normLabel(s: string): string {
  return cleanText(s)
    .toLowerCase()
    .replace(/\((aed|sar|kwd|qar|bhd|omr|usd|eur|gbp)\)/g, "")
    .replace(/\b(aed|sar)\b$/, "")
    .replace(/[:]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const roleOf = (label: string): ColumnRole | undefined => ROLE_BY_PHRASE.get(normLabel(label));

type Segment = { words: Word[]; name: string; role?: ColumnRole };

/** Header cells of a line. Tightly set labels ("Date Description") are split when each part is a known label. */
function headerSegments(line: Line): Segment[] {
  const out: Segment[] = [];
  for (const cluster of clusters(line)) {
    const whole = joinWords(cluster);
    if (roleOf(whole)) {
      out.push({ words: cluster, name: whole, role: roleOf(whole) });
      continue;
    }
    // Greedy longest known phrase from the left; split only if every word lands in one.
    const parts: Segment[] = [];
    let i = 0;
    while (i < cluster.length) {
      let j = cluster.length;
      while (j > i && !roleOf(joinWords(cluster.slice(i, j)))) j--;
      if (j === i) break;
      const words = cluster.slice(i, j);
      parts.push({ words, name: joinWords(words), role: roleOf(joinWords(words)) });
      i = j;
    }
    if (i === cluster.length && parts.length > 1) out.push(...parts);
    else {
      const inner = cluster.map((w) => roleOf(w.text)).find((r) => r && r !== "other");
      out.push({ words: cluster, name: whole, role: inner });
    }
  }
  return out;
}

const isDate = (s: string) => DATE_TOKEN_RE.test(s.trim());
const isMoney = (s: string) => parseAmount(s) !== undefined && /\.\d{1,3}\b|\d,\d{3}/.test(s);

function headerScore(line: Line): number {
  const segs = headerSegments(line);
  if (segs.length < 3) return 0;
  if (line.words.some((w) => isDate(w.text) || isMoney(w.text))) return 0;
  const known = segs.filter((s) => s.role && s.role !== "other").length;
  const any = segs.filter((s) => s.role).length;
  if (known < 2) return 0;
  return known + 0.5 * (any - known) + (any === segs.length ? 1 : 0);
}

const tokensOf = (line: Line) => headerSegments(line).map((s) => normLabel(s.name));

function similarity(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / Math.max(1, new Set([...A, ...B]).size);
}

// ─── Special lines ────────────────────────────────────────────────────────

const OPENING = /\b(balance\s+)?(brought\s+forward|b\/f|b\/fwd)\b|\bopening\s+balance\b|\bbalance\s+forward\b|الرصيد\s+(الافتتاحي|المنقول|السابق)|رصيد\s+(افتتاحي|سابق)/i;
const CLOSING = /\b(balance\s+)?(carried\s+forward|c\/f|c\/fwd)\b|\bclosing\s+balance\b|الرصيد\s+(الختامي|المرحل|الحالي)|رصيد\s+ختامي/i;
const SUMMARY = /^(grand\s+total|sub\s*-?\s*total|total|totals|vat|tax|amount\s+due|balance\s+due|discount|shipping|الإجمالي|المجموع|إجمالي|ضريبة)\b/i;
const FOOTER = /\bpage\s+\d+\s*(of|\/)\s*\d+\b|^page\s+\d+$|صفحة\s+\d+|\bcontinued\b|this is a (computer|system)[- ]generated/i;

export type SpecialKind = "opening" | "closing" | "total";

export type ExtractedRow = { cells: string[]; page: number; y: number };
export type SpecialRow = { kind: SpecialKind; cells: string[]; text: string; page: number; y: number };

export type TableExtraction = {
  columns: LayoutColumn[];
  headerTokens: string[];
  rows: ExtractedRow[];
  specials: SpecialRow[];
  /** Lines outside the table: titles, account details, footers. */
  metaLines: Line[];
  repeatedHeaders: number;
};

const NUMERIC_ROLES = new Set<ColumnRole>(["debit", "credit", "amount", "balance", "qty", "unit_price", "net", "vat_rate", "vat", "total"]);
const TEXT_ROLES = new Set<ColumnRole>(["description", "other", "reference", "sku"]);

type Band = { col: number; x0: number; x1: number };

/** Column extents on a page: header cells widened by the data that sits under them. */
function pageBands(columns: LayoutColumn[], body: Line[]): { bands: Band[]; ambiguous: Band[] } {
  // Lines with two or more spaced-out clusters are table rows; long sentences and wrapped narration are not.
  const intervals = body
    .filter((l) => clusters(l).length >= 2)
    .flatMap((l) => l.words.map((w) => [w.x0, w.x1, w.h] as const))
    .sort((a, b) => a[0] - b[0]);
  const regions: [number, number][] = [];
  for (const [a, b, h] of intervals) {
    const last = regions[regions.length - 1];
    if (last && a <= last[1] + 0.3 * h) last[1] = Math.max(last[1], b);
    else regions.push([a, b]);
  }
  const bands: Band[] = columns.map((c, col) => ({ col, x0: c.x0, x1: c.x1 }));
  const ambiguous: Band[] = [];
  const dist = (r: [number, number], c: LayoutColumn) => Math.max(0, c.x0 - r[1], r[0] - c.x1);
  for (const r of regions) {
    const over = columns.map((c, i) => ({ i, o: Math.min(r[1], c.x1) - Math.max(r[0], c.x0) })).filter((x) => x.o > 0);
    if (over.length >= 2) {
      ambiguous.push({ col: -1, x0: r[0], x1: r[1] });
      continue;
    }
    const col = over.length === 1 ? over[0].i : columns.map((c, i) => ({ i, d: dist(r, c) })).sort((a, b) => a.d - b.d)[0].i;
    bands[col].x0 = Math.min(bands[col].x0, r[0]);
    bands[col].x1 = Math.max(bands[col].x1, r[1]);
  }
  return { bands, ambiguous };
}

function assignWord(w: Word, columns: LayoutColumn[], bands: Band[], ambiguous: Band[]): number {
  const inAmbiguous = ambiguous.some((a) => w.x0 >= a.x0 - 0.5 && w.x1 <= a.x1 + 0.5);
  const targets = inAmbiguous ? columns.map((c, col) => ({ col, x0: c.x0, x1: c.x1 })) : bands;
  // Numbers are usually right-aligned under their header, text left-aligned.
  const numeric = isMoney(w.text) || /^\d+(\.\d+)?%?$/.test(w.text);
  const scored = targets.map((b) => {
    const overlap = Math.min(w.x1, b.x1) - Math.max(w.x0, b.x0);
    const role = columns[b.col].role;
    const edge = numeric ? Math.abs(w.x1 - b.x1) : Math.abs(w.x0 - b.x0);
    const gap = Math.max(0, b.x0 - w.x1, w.x0 - b.x1);
    const affinity = numeric === NUMERIC_ROLES.has(role) ? 0 : 1;
    return { col: b.col, key: overlap > 0 ? [0, affinity, -overlap] : [1, gap, edge] };
  });
  scored.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2]);
  return scored[0].col;
}

function cellsOf(line: Line, columns: LayoutColumn[], bands: Band[], ambiguous: Band[]): string[] {
  const buckets: Word[][] = columns.map(() => []);
  for (const w of line.words) buckets[assignWord(w, columns, bands, ambiguous)].push(w);
  return buckets.map((ws) => joinWords(ws));
}

export type ReadTableOptions = { recipes?: LayoutRecipe[] };

/** Finds the header line: a saved recipe's header first, else the best-scoring line by vocabulary. */
function findHeader(lines: Line[], recipes: LayoutRecipe[]): { line: Line; recipe?: LayoutRecipe } | undefined {
  for (const recipe of recipes) {
    const hit = lines.find((l) => similarity(tokensOf(l), recipe.headerTokens) >= 0.8);
    if (hit) return { line: hit, recipe };
  }
  let best: { line: Line; score: number } | undefined;
  for (const l of lines) {
    const s = headerScore(l);
    if (s > 0 && (!best || s > best.score + 0.01 || (Math.abs(s - best.score) <= 0.01 && l.page < best.line.page))) best = { line: l, score: s };
  }
  return best && { line: best.line };
}

export function readTable(lines: Line[], opts: ReadTableOptions = {}): (TableExtraction & { recipe?: LayoutRecipe }) | undefined {
  const found = findHeader(lines, opts.recipes ?? []);
  if (!found) return undefined;
  const segs = headerSegments(found.line);
  const recipeRoles = found.recipe && new Map(found.recipe.columns.map((c) => [normLabel(c.name), c.role]));
  let columns: LayoutColumn[] = segs.map((s) => ({
    name: s.name,
    role: recipeRoles?.get(normLabel(s.name)) ?? s.role ?? "other",
    x0: s.words[0].x0,
    x1: s.words[s.words.length - 1].x1,
  }));
  const headerTokens = segs.map((s) => normLabel(s.name));

  const result: TableExtraction = { columns, headerTokens, rows: [], specials: [], metaLines: [], repeatedHeaders: 0 };
  const dateCol = columns.findIndex((c) => c.role === "date" || c.role === "value_date");
  const qtyCol = columns.findIndex((c) => c.role === "qty");
  const textCols = columns.map((c, i) => (TEXT_ROLES.has(c.role) ? i : -1)).filter((i) => i >= 0);

  const pages = [...new Set(lines.map((l) => l.page))].sort((a, b) => a - b);
  let started = false;
  for (const page of pages) {
    const pageLines = lines.filter((l) => l.page === page);
    if (page < found.line.page) {
      result.metaLines.push(...pageLines);
      continue;
    }
    const header = page === found.line.page ? found.line : pageLines.find((l) => similarity(tokensOf(l), headerTokens) >= 0.7);
    if (header && header !== found.line) result.repeatedHeaders++;
    const startY = header ? header.y : -Infinity;
    // Above the header: page titles and statement details. On header-less pages, everything is body.
    result.metaLines.push(...pageLines.filter((l) => l.y < startY));
    const body = pageLines.filter((l) => l.y > startY && !(header && l === header));
    const { bands, ambiguous } = pageBands(columns, body);

    let last: { row?: ExtractedRow; y: number; h: number } | undefined = header ? { y: header.y, h: header.h } : undefined;
    let ended = false;
    for (const line of body) {
      if (ended || FOOTER.test(line.text)) {
        result.metaLines.push(line);
        continue;
      }
      if (similarity(tokensOf(line), headerTokens) >= 0.7) {
        result.repeatedHeaders++;
        continue;
      }
      const cells = cellsOf(line, columns, bands, ambiguous);
      const hasDate = dateCol >= 0 && isDate(cells[dateCol].split(" ")[0] ?? "");
      const money = columns.some((c, i) => NUMERIC_ROLES.has(c.role) && isMoney(cells[i].replace(/\s?(cr|dr)$/i, "")));
      const qty = qtyCol >= 0 && /^\d+(\.\d+)?$/.test(cells[qtyCol]);
      const gap = last ? line.y - last.y : 0;
      const near = last !== undefined && gap <= 2.6 * Math.max(line.h, last.h);

      const special = OPENING.test(line.text) ? "opening" : CLOSING.test(line.text) ? "closing" : undefined;
      if (special && money) {
        result.specials.push({ kind: special, cells, text: line.text, page, y: line.y });
        last = { y: line.y, h: line.h };
        started = true;
        continue;
      }
      const firstText = textCols.map((i) => cells[i]).find((c) => c) ?? line.text;
      if (money && !hasDate && !qty && (SUMMARY.test(firstText) || SUMMARY.test(line.text))) {
        result.specials.push({ kind: "total", cells, text: line.text, page, y: line.y });
        last = { y: line.y, h: line.h };
        continue;
      }

      // Wrapped narration sits in the text columns; a sentence starting at the left margin is not part of the row.
      const foldable = (c: string[], prev: string[]) =>
        c.every((v, i) => !v || TEXT_ROLES.has(columns[i].role) || (NUMERIC_ROLES.has(columns[i].role) && !prev[i]));
      const startsRow = dateCol >= 0 ? hasDate && (money || started || qty) : money || qty;
      if (startsRow) {
        const row = { cells, page, y: line.y };
        result.rows.push(row);
        last = { row, y: line.y, h: line.h };
        started = true;
      } else if (last?.row && near && !hasDate && foldable(cells, last.row.cells)) {
        // A wrapped line: fold its text into the row above, and fill any amount the first line lacked.
        cells.forEach((c, i) => {
          if (!c) return;
          const prev = last!.row!.cells[i];
          if (NUMERIC_ROLES.has(columns[i].role)) {
            if (!prev) last!.row!.cells[i] = c;
          } else last!.row!.cells[i] = prev ? `${prev} ${c}` : c;
        });
        last = { row: last.row, y: line.y, h: line.h };
      } else if (started && last && !near && result.rows.length > 0) {
        // A big vertical gap after the rows: the table is over on this page.
        ended = true;
        result.metaLines.push(line);
      } else result.metaLines.push(line);
    }
  }

  // Unrecognised header cells that never got a value are noise (e.g. a split two-line header).
  const used = columns.map((c, i) => c.role !== "other" || result.rows.some((r) => r.cells[i]));
  if (used.some((u) => !u) && used.some(Boolean)) {
    const keep = (arr: string[]) => arr.filter((_, i) => used[i]);
    columns = columns.filter((_, i) => used[i]);
    result.columns = columns;
    result.headerTokens = keep(result.headerTokens);
    for (const r of result.rows) r.cells = keep(r.cells);
    for (const s of result.specials) s.cells = keep(s.cells);
  }
  // Arabic headers read right to left: list columns in reading order.
  if (columns.filter((c) => ARABIC.test(c.name)).length > columns.length / 2) {
    result.columns = [...result.columns].reverse();
    result.headerTokens = [...result.headerTokens].reverse();
    for (const r of result.rows) r.cells.reverse();
    for (const s of result.specials) s.cells.reverse();
  }
  return { ...result, recipe: found.recipe };
}

/** Amount cells become plain signed numbers: "1,234.50 DR" → "-1,234.50" for balances, "(10.00)" → "-10.00". */
export function normalizeAmountCell(cell: string, role: ColumnRole): string {
  const n = parseAmount(cell);
  if (n === undefined || !NUMERIC_ROLES.has(role)) return cell;
  const decimals = /\.(\d+)/.exec(cell)?.[1].length ?? 0;
  const v = role === "debit" || role === "credit" ? Math.abs(n) : n;
  return (v < 0 ? "-" : "") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export { isDate, isMoney };
