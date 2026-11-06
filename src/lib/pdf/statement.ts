import { isMoney, normalizeAmountCell, type Line, type SpecialRow, type TableExtraction } from "./layout";
import { cents, findCurrency, formatAmount, parseAmount } from "./text";
import type { PdfCheck, StatementMeta } from "./types";

// Bank statements: metadata (account, period, opening/closing balance) kept apart from
// the rows, and balance checks run before any matching.

const DATE = String.raw`(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[ -][A-Za-z]{3,9}[ -,]+\d{2,4}|[A-Za-z]{3,9} \d{1,2},? \d{4})`;
const PERIOD = new RegExp(String.raw`(?:period|from|statement\s+date)\s*[:\-]?\s*${DATE}\s*(?:to|-|–|until|till)\s*${DATE}`, "i");
const PERIOD_AR = new RegExp(String.raw`(?:من|الفترة)\s*[:\-]?\s*${DATE}\s*(?:إلى|الى|حتى|-)\s*${DATE}`);
const ACCOUNT = /(?:account|a\/c|acct)\.?\s*(?:no\.?|number|#|num)?\s*[:\-]?\s*(\d[\d\- ]{4,}\d)\b/i;
const ACCOUNT_AR = /رقم\s+الحساب\s*[:\-]?\s*(\d[\d\- ]{4,}\d)/;
const IBAN = /\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?)\b/;
const OPENING = /opening\s+balance|balance\s+brought\s+forward|الرصيد\s+الافتتاحي|رصيد\s+افتتاحي/i;
const CLOSING = /closing\s+balance|الرصيد\s+الختامي|رصيد\s+ختامي/i;
const TOTAL_DEBITS = /total\s+(debits?|withdrawals?)|إجمالي\s+(المدين|السحوبات)/i;
const TOTAL_CREDITS = /total\s+(credits?|deposits?)|إجمالي\s+(الدائن|الإيداعات)/i;

const moneyIn = (text: string): number | undefined => {
  const tokens = text.split(/\s+/).filter((t) => isMoney(t.replace(/^(AED|SAR)/i, "")));
  // "1,000.00 Cr" and "1,000.00 DR" carry their sign in the next token.
  const words = text.split(/\s+/);
  const last = tokens[tokens.length - 1];
  if (last === undefined) return undefined;
  const next = words[words.indexOf(last) + 1];
  return parseAmount(/^(cr|dr)$/i.test(next ?? "") ? `${last} ${next}` : last);
};

export type StatementTable = { headers: string[]; rows: string[][]; meta: StatementMeta; checks: PdfCheck[]; skipped: number };

export function buildStatement(t: TableExtraction): StatementTable {
  const roles = t.columns.map((c) => c.role);
  const col = (role: string) => roles.indexOf(role as (typeof roles)[number]);
  const meta = statementMeta(t.metaLines, t.specials, t);

  let headers = t.columns.map((c) => c.name);
  let rows = t.rows.map((r) => r.cells.map((c, i) => normalizeAmountCell(c, t.columns[i].role)));

  // A single signed Amount column (or Amount + Dr/Cr) also gets Debit and Credit columns for matching.
  let debitAt = col("debit");
  let creditAt = col("credit");
  const amountAt = col("amount");
  if (amountAt >= 0 && debitAt < 0 && creditAt < 0) {
    const sideAt = t.columns.findIndex((_, i) => rows.length > 0 && rows.every((r) => /^(dr|cr|debit|credit|d|c)?$/i.test(r[i])) && rows.some((r) => r[i]));
    headers = [...headers, "Debit", "Credit"];
    rows = rows.map((r) => {
      const n = parseAmount(r[amountAt]) ?? 0;
      const side = sideAt >= 0 ? r[sideAt].toLowerCase() : "";
      const debit = side.startsWith("d") || (!side && n < 0);
      const v = formatAmount(Math.abs(n));
      return [...r, debit && n !== 0 ? v : "", !debit && n !== 0 ? v : ""];
    });
    debitAt = headers.length - 2;
    creditAt = headers.length - 1;
  }
  const balanceAt = col("balance");
  const checks = statementChecks(t, rows, { debitAt, creditAt, balanceAt }, meta);
  return { headers, rows, meta, checks, skipped: t.specials.length + t.repeatedHeaders };
}

function statementMeta(lines: Line[], specials: SpecialRow[], t: TableExtraction): StatementMeta {
  const meta: StatementMeta = {};
  const firstPage = Math.min(...lines.map((l) => l.page), Infinity);
  const top = lines.filter((l) => l.page === firstPage).sort((a, b) => a.y - b.y)[0];
  if (top) meta.issuer = top.text;

  for (const l of lines) {
    const s = l.text;
    meta.accountNumber ??= (ACCOUNT.exec(s) ?? ACCOUNT_AR.exec(s))?.[1].trim();
    meta.iban ??= IBAN.exec(s.toUpperCase())?.[1].replace(/\s/g, "");
    const p = PERIOD.exec(s) ?? PERIOD_AR.exec(s);
    if (p && !meta.periodFrom) [meta.periodFrom, meta.periodTo] = [p[1], p[2]];
    if (OPENING.test(s)) meta.openingBalance ??= moneyIn(s);
    if (CLOSING.test(s)) meta.closingBalance = moneyIn(s) ?? meta.closingBalance;
    if (TOTAL_DEBITS.test(s)) meta.totalDebits ??= moneyIn(s.replace(TOTAL_CREDITS, ""));
    if (TOTAL_CREDITS.test(s)) meta.totalCredits ??= moneyIn(s);
  }
  meta.currency = findCurrency([...lines.map((l) => l.text), ...t.columns.map((c) => c.name)].join(" "));
  if (meta.accountNumber && meta.iban?.endsWith(meta.accountNumber.replace(/\D/g, ""))) delete meta.accountNumber;

  const balanceAt = t.columns.findIndex((c) => c.role === "balance");
  const valueOf = (s: SpecialRow) => (balanceAt >= 0 ? parseAmount(s.cells[balanceAt]) : undefined) ?? moneyIn(s.text);
  const opening = specials.find((s) => s.kind === "opening");
  const closing = [...specials].reverse().find((s) => s.kind === "closing");
  if (opening && meta.openingBalance === undefined) meta.openingBalance = valueOf(opening);
  // The last carried-forward on the last page is the closing balance when none is printed.
  if (closing && meta.closingBalance === undefined && closing.page === Math.max(...t.rows.map((r) => r.page), closing.page)) {
    meta.closingBalance = valueOf(closing);
  }
  for (const s of specials.filter((x) => x.kind === "total")) {
    const debit = t.columns.findIndex((c) => c.role === "debit");
    const credit = t.columns.findIndex((c) => c.role === "credit");
    if (debit >= 0 && parseAmount(s.cells[debit]) !== undefined) meta.totalDebits = Math.abs(parseAmount(s.cells[debit])!);
    if (credit >= 0 && parseAmount(s.cells[credit]) !== undefined) meta.totalCredits = Math.abs(parseAmount(s.cells[credit])!);
  }
  return meta;
}

function statementChecks(
  t: TableExtraction,
  rows: string[][],
  at: { debitAt: number; creditAt: number; balanceAt: number },
  meta: StatementMeta,
): PdfCheck[] {
  const checks: PdfCheck[] = [];
  if (at.debitAt < 0 && at.creditAt < 0) return checks;
  const amt = (r: string[], i: number) => (i >= 0 ? Math.abs(parseAmount(r[i]) ?? 0) : 0);
  const credits = rows.reduce((s, r) => s + cents(amt(r, at.creditAt)), 0);
  const debits = rows.reduce((s, r) => s + cents(amt(r, at.debitAt)), 0);
  const ccy = meta.currency ? `${meta.currency} ` : "";
  const money = (c: number) => `${ccy}${formatAmount(c / 100)}`;

  if (meta.openingBalance !== undefined && meta.closingBalance !== undefined) {
    const expected = cents(meta.openingBalance) + credits - debits;
    const ok = expected === cents(meta.closingBalance);
    checks.push({
      id: "balance_equation",
      label: "Opening + credits − debits = closing",
      ok,
      detail: ok
        ? `${money(cents(meta.openingBalance))} + ${money(credits)} − ${money(debits)} = ${money(expected)}, as printed.`
        : `${money(cents(meta.openingBalance))} + ${money(credits)} − ${money(debits)} = ${money(expected)}, but the statement says ${money(cents(meta.closingBalance))} (off by ${money(Math.abs(expected - cents(meta.closingBalance)))}). Some rows may be missing or misread.`,
    });
  }

  if (meta.totalDebits !== undefined || meta.totalCredits !== undefined) {
    const bad: string[] = [];
    if (meta.totalCredits !== undefined && cents(meta.totalCredits) !== credits) bad.push(`credits add up to ${money(credits)}, printed total ${money(cents(meta.totalCredits))}`);
    if (meta.totalDebits !== undefined && cents(meta.totalDebits) !== debits) bad.push(`debits add up to ${money(debits)}, printed total ${money(cents(meta.totalDebits))}`);
    checks.push({
      id: "printed_totals",
      label: "Rows add up to the printed totals",
      ok: bad.length === 0,
      detail: bad.length === 0 ? "Debit and credit rows add up to the totals printed on the statement." : `The ${bad.join("; ")}.`,
    });
  }

  if (at.balanceAt >= 0) {
    // Walk rows and carried-forward lines in page order; every printed balance must follow from the one before.
    type Step = { page: number; y: number; row?: string[]; index?: number; special?: SpecialRow };
    const steps: Step[] = [
      ...t.rows.map((r, index) => ({ page: r.page, y: r.y, row: rows[index], index })),
      ...t.specials.filter((s) => s.kind !== "total").map((s) => ({ page: s.page, y: s.y, special: s })),
    ].sort((a, b) => a.page - b.page || a.y - b.y);
    const balanceCol = t.columns.findIndex((c) => c.role === "balance");
    let running = meta.openingBalance !== undefined ? cents(meta.openingBalance) : undefined;
    let alt: number | undefined;
    const misses: string[] = [];
    let checked = 0;
    for (const s of steps) {
      if (s.special) {
        const printed = parseAmount(s.special.cells[balanceCol] ?? "");
        if (printed === undefined) continue;
        if (running === undefined) running = cents(printed);
        else if (cents(printed) !== running) misses.push(`"${s.special.text.slice(0, 40)}" on page ${s.page} shows ${money(cents(printed))}, expected ${money(running)}`);
        continue;
      }
      const r = s.row!;
      const delta = cents(amt(r, at.creditAt)) - cents(amt(r, at.debitAt));
      const printed = parseAmount(r[at.balanceAt]);
      if (running === undefined) {
        if (printed !== undefined) running = cents(printed);
        continue;
      }
      running += delta;
      if (alt !== undefined) alt += delta;
      if (printed === undefined) continue;
      checked++;
      if (cents(printed) === running) {
        alt = undefined;
        continue;
      }
      // After a break, rows that follow on from the printed figure mean an earlier row was
      // missing or misread (already reported); rows that follow the expected one mean a one-off misprint.
      if (alt !== undefined && cents(printed) === alt) {
        running = alt;
        alt = undefined;
        continue;
      }
      misses.push(`row ${s.index! + 1} shows ${money(cents(printed))}, expected ${money(running)}`);
      alt = cents(printed);
    }
    if (checked > 0 || misses.length > 0) {
      checks.push({
        id: "running_balance",
        label: "Running balance follows every row",
        ok: misses.length === 0,
        detail:
          misses.length === 0
            ? `All ${checked} printed balances follow from the row before.`
            : `${misses.length} balance${misses.length === 1 ? " doesn't" : "s don't"} follow: ${misses.slice(0, 3).join("; ")}${misses.length > 3 ? "; …" : ""}.`,
      });
    }
  }
  return checks;
}

export function statementMetaRows(meta: StatementMeta): { label: string; value: string }[] {
  const ccy = meta.currency ? `${meta.currency} ` : "";
  const out: { label: string; value: string }[] = [];
  if (meta.issuer) out.push({ label: "Issuer", value: meta.issuer });
  if (meta.accountNumber) out.push({ label: "Account", value: meta.accountNumber });
  if (meta.iban) out.push({ label: "IBAN", value: meta.iban });
  if (meta.periodFrom) out.push({ label: "Period", value: `${meta.periodFrom} – ${meta.periodTo}` });
  if (meta.currency) out.push({ label: "Currency", value: meta.currency });
  if (meta.openingBalance !== undefined) out.push({ label: "Opening balance", value: ccy + formatAmount(meta.openingBalance) });
  if (meta.closingBalance !== undefined) out.push({ label: "Closing balance", value: ccy + formatAmount(meta.closingBalance) });
  return out;
}
