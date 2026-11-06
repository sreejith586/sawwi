import type { Dataset, Rec } from "@/lib/recon/load";
import type { ReconException, ReconResult } from "@/lib/recon/match";
import { severityOf, type Severity } from "@/lib/recon/severity";
import type { BreakdownRow, RunFile } from "@/lib/runs/types";
import type { Check, CheckRule, Template } from "@/lib/templates/types";

// Everything here is deterministic and free: the facts the LLM phrases, and the answers
// Sawwi gives on its own when no API key is set. The LLM never sees rows from here,
// only totals, per-check counts and values, and a handful of exceptions by key.

export const money = (value: number, currency?: string) => {
  const n = value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${n}` : n;
};
const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function slotLabel(t: Template, key: string) {
  return t.sources.find((s) => s.key === key)?.label ?? key;
}

/** Plain-language summary written by code, not the LLM: free, instant and always accurate. */
export function summarize(r: ReconResult, leftLabel: string): string {
  const main = r.links[0];
  const rate = main?.leftRows ? Math.round((main.matchedLeft / main.leftRows) * 1000) / 10 : 0;
  let text = `Done. Matched ${(main?.matchedLeft ?? 0).toLocaleString()} of ${(main?.leftRows ?? 0).toLocaleString()} rows in your ${leftLabel.toLowerCase()} (${rate}%).`;
  const found = findings(r);
  if (found.length === 0) return `${text} No exceptions found. Everything reconciles.`;
  text += ` I found ${r.totals.exceptions.toLocaleString()} exceptions worth ${money(r.totals.value, r.currency)}.`;
  text += " Biggest: " + found.slice(0, 3).map((c) => `${c.label.toLowerCase()} (${c.count}${c.value ? `, ${money(c.value, r.currency)}` : ""})`).join("; ") + ".";
  return text;
}

const findings = (r: ReconResult) => r.checks.filter((c) => c.status === "done" && c.count > 0).sort((a, b) => b.value - a.value || b.count - a.count);

// ─── What to fix first ──────────────────────────────────────────────────────

const WEIGHT: Record<Severity, number> = { high: 1, medium: 0.5, info: 0.1 };

export type FixItem = { check: string; checkLabel: string; severity: Severity; count: number; value: number; action: string };

/** The next step for a finding, by the kind of rule that raised it. */
export function fixAction(t: Template, check: Check): string {
  const rule = check.rule;
  if (!rule) return "Review these items by hand.";
  const link = "link" in rule ? t.links[rule.link] : undefined;
  const L = link ? slotLabel(t, link.left).toLowerCase() : "";
  const R = link ? slotLabel(t, link.right).toLowerCase() : "";
  const actions: Record<CheckRule["kind"], string> = {
    unmatched_left: `Find each item in the ${R}: if it's genuinely missing, chase it; if it's there under another reference, fix the key and re-run.`,
    unmatched_right: `Trace these ${R} lines back to your ${L}: post what's missing, or query lines you don't recognise.`,
    compare: `Raise a claim or query for each difference, largest first, with both amounts as evidence.`,
    duplicate: `Confirm which copy is genuine, then cancel or credit the duplicates before they're paid twice.`,
    multi_value: `Check these items and correct the conflicting values at the source.`,
    older_than: `Chase the oldest items first; they're the hardest to recover.`,
    due_within: `Plan for these: they fall due soon.`,
    row_match: `Review each flagged line and confirm it was expected.`,
    pair_match: `Check each pair and agree the treatment with the other party.`,
    date_outside: `Confirm the right price or rate applied on those dates and raise a correction if not.`,
    vat_rate: `Correct the VAT on these lines before the return is filed.`,
  };
  return actions[rule.kind];
}

/** Checks with findings, ordered by money at risk weighted by severity. */
export function fixFirst(t: Template, r: ReconResult): FixItem[] {
  const meta = new Map(t.checks.map((c) => [c.id, c]));
  return r.checks
    .filter((c) => c.status === "done" && c.count > 0)
    .map((c) => {
      const check = meta.get(c.id);
      const severity = severityOf(check?.rule);
      return { check: c.id, checkLabel: c.label, severity, count: c.count, value: c.value, action: check ? fixAction(t, check) : "Review these items." };
    })
    .sort((a, b) => b.value * WEIGHT[b.severity] - a.value * WEIGHT[a.severity] || WEIGHT[b.severity] - WEIGHT[a.severity] || b.count - a.count);
}

// ─── Narrative ──────────────────────────────────────────────────────────────

export type Narrative = { headline: string; findings: string[]; nextSteps: string[] };

export function ruleNarrative(t: Template, r: ReconResult): Narrative {
  const headline = summarize(r, slotLabel(t, t.links[0]?.left ?? ""));
  const desc = new Map(t.checks.map((c) => [c.id, c.description]));
  return {
    headline,
    findings: findings(r)
      .slice(0, 4)
      .map((c) => `${c.label}: ${plural(c.count, "item")}${c.value ? ` worth ${money(c.value, r.currency)}` : ""}. ${desc.get(c.id) ?? ""}`.trim()),
    nextSteps: fixFirst(t, r)
      .slice(0, 3)
      .map((f) => `${f.checkLabel}: ${f.action}`),
  };
}

// ─── Digest: the only view of a run the LLM gets ────────────────────────────

const TOP_EXCEPTIONS = 8;
const cell = (v: string | number | undefined) => (v === undefined ? "" : String(v).replace(/[\t\n\r]+/g, " ").slice(0, 80));

/**
 * Compact TSV of a run: totals, how the files matched, every check's count and value, and the
 * largest few exceptions by key. Byte-stable for a given result, so it can sit in the cached
 * prompt prefix and every follow-up question about the run reads it from cache.
 */
export function digestText(t: Template, r: ReconResult): string {
  const meta = new Map(t.checks.map((c) => [c.id, c]));
  const lines: string[] = [
    `Reconciliation: ${t.title}`,
    `Data as of: ${r.asOf}`,
    `Currency: ${r.currency ?? "unknown"}`,
    `Exceptions: ${r.totals.exceptions}`,
    `Value at risk: ${r.totals.value.toFixed(2)}`,
    "",
    "Files matched",
    ["left", "right", "left_rows", "right_rows", "matched_left", "matched_right", "left_total", "right_total", "note"].join("\t"),
    ...r.links.map((l) =>
      [slotLabel(t, l.left), slotLabel(t, l.right), l.leftRows, l.rightRows, l.matchedLeft, l.matchedRight, l.leftTotal?.toFixed(2), l.rightTotal?.toFixed(2), l.skipped].map(cell).join("\t"),
    ),
    "",
    "Checks",
    ["check", "severity", "status", "count", "value", "what_it_checks"].join("\t"),
    ...r.checks.map((c) =>
      [c.label, severityOf(meta.get(c.id)?.rule), c.status === "done" ? "checked" : c.reason ?? c.status, c.count, c.value.toFixed(2), meta.get(c.id)?.description].map(cell).join("\t"),
    ),
    "",
    `Largest exceptions (top ${TOP_EXCEPTIONS} by value)`,
    ["check", "key", "left_value", "right_value", "difference", "at_risk", "note"].join("\t"),
    ...topExceptions(r, TOP_EXCEPTIONS).map((e) =>
      [meta.get(e.check)?.label ?? e.check, e.key, e.leftValue?.toFixed(2), e.rightValue?.toFixed(2), e.diff?.toFixed(2), Math.abs(e.value).toFixed(2), e.note].map(cell).join("\t"),
    ),
  ];
  return lines.join("\n");
}

export function topExceptions(r: ReconResult, n: number, check?: string): ReconException[] {
  return r.exceptions
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => !check || e.check === check)
    .sort((a, b) => Math.abs(b.e.value) - Math.abs(a.e.value) || a.i - b.i)
    .slice(0, n)
    .map(({ e }) => e);
}

// ─── Breakdowns ─────────────────────────────────────────────────────────────

export type Dimension = { key: string; label: string };

/** Fields that have a column, per slot: what a breakdown can group by. */
export function mappedFields(files: RunFile[]): Map<string, Set<string>> {
  return new Map(files.map((f) => [f.slotKey, new Set(Object.entries(f.mapping.fields).filter(([, m]) => m.column).map(([k]) => k))]));
}

const PREFERRED = ["sku", "customer", "supplier", "transaction_type", "payment_method", "order_status", "courier", "provider", "category", "warehouse"];
const NOT_A_DIMENSION = new Set(["currency", "description", "reference", "note", "narration"]);

function slotsOf(t: Template, rule: CheckRule | undefined): string[] {
  if (!rule) return [];
  if ("slot" in rule) return [rule.slot];
  const l = t.links[rule.link];
  return l ? [l.left, l.right] : [];
}

/**
 * Ways to slice a check's exceptions: by key, by month, and by low-cardinality text fields
 * (SKU, customer, transaction type...) that are mapped in the files involved.
 * `mapped` lists the fields with a column, per slot.
 */
export function breakdownOptions(t: Template, checkId: string, mapped: Map<string, Set<string>>): Dimension[] {
  const check = t.checks.find((c) => c.id === checkId);
  const slots = slotsOf(t, check?.rule);
  const link = check?.rule && "link" in check.rule ? t.links[check.rule.link] : undefined;
  const keyFields = new Set(link?.keys.flatMap((k) => [k.left, k.right]) ?? []);
  const keyLabel = link ? (t.sources.find((s) => s.key === link.left)?.fields.find((f) => f.key === link.keys[0]?.left)?.label ?? "Key") : "Key";

  const out: Dimension[] = [{ key: "key", label: keyLabel }];
  const fields = slots.flatMap((s) => (t.sources.find((x) => x.key === s)?.fields ?? []).filter((f) => mapped.get(s)?.has(f.key)));
  if (fields.some((f) => f.type === "date")) out.push({ key: "month", label: "Month" });
  const extra = fields
    .filter((f) => (f.type === "text" || f.key === "sku") && !keyFields.has(f.key) && !NOT_A_DIMENSION.has(f.key))
    .filter((f, i, all) => all.findIndex((x) => x.key === f.key) === i)
    .sort((a, b) => rank(a.key) - rank(b.key));
  for (const f of extra.slice(0, 4)) out.push({ key: f.key, label: f.label });
  return out;
}
const rank = (k: string) => (PREFERRED.includes(k) ? PREFERRED.indexOf(k) : PREFERRED.length);

/** Records behind an exception, left side first, read from the loaded files. */
function recordsOf(e: ReconException, index: Map<string, Map<number, Rec>>): Rec[] {
  const out: Rec[] = [];
  for (const ref of [e.left, e.right]) {
    const rows = ref && index.get(ref.slot);
    if (!rows) continue;
    for (const n of ref.rows.slice(0, 5)) {
      const rec = rows.get(n);
      if (rec) out.push(rec);
    }
  }
  return out;
}

export function indexDatasets(datasets: Map<string, Dataset>): Map<string, Map<number, Rec>> {
  return new Map([...datasets].map(([slot, d]) => [slot, new Map(d.rows.map((r) => [r.rowNumber, r]))]));
}

export const BLANK = "(blank)";

/** Groups one check's exceptions by a dimension: count and value per group, largest first. */
export function breakdown(
  t: Template,
  r: ReconResult,
  datasets: Map<string, Dataset>,
  checkId: string,
  by: string,
): { rows: BreakdownRow[]; totalGroups: number } {
  const index = indexDatasets(datasets);
  const dateFields = new Map(t.sources.map((s) => [s.key, s.fields.filter((f) => f.type === "date").map((f) => f.key)]));
  const groups = new Map<string, BreakdownRow>();
  for (const e of r.exceptions) {
    if (e.check !== checkId) continue;
    let group: string | undefined;
    if (by === "key") group = e.key;
    else {
      const recs = recordsOf(e, index);
      if (by === "month") {
        for (const rec of recs) {
          const d = (dateFields.get(rec.slot) ?? []).map((f) => rec.date[f]).find(Boolean);
          if (d) {
            group = d.slice(0, 7);
            break;
          }
        }
      } else group = recs.map((rec) => rec.raw[by]).find((v) => v && v.trim())?.trim();
    }
    const g = group || BLANK;
    const row = groups.get(g) ?? { group: g, count: 0, value: 0 };
    row.count++;
    row.value = Math.round((row.value + Math.abs(e.value)) * 100) / 100;
    groups.set(g, row);
  }
  const rows = [...groups.values()].sort((a, b) =>
    by === "month" ? a.group.localeCompare(b.group) : b.value - a.value || b.count - a.count || a.group.localeCompare(b.group),
  );
  return { rows, totalGroups: rows.length };
}

/** One sentence on where a breakdown concentrates. */
export function describeBreakdown(rows: BreakdownRow[], byLabel: string, currency?: string): string {
  if (rows.length === 0) return "Nothing to break down: this check found no exceptions.";
  const total = rows.reduce((s, r) => s + r.value, 0);
  const count = rows.reduce((s, r) => s + r.count, 0);
  const top = [...rows].sort((a, b) => b.value - a.value || b.count - a.count)[0];
  const share = total ? Math.round((top.value / total) * 100) : Math.round((top.count / count) * 100);
  const by = lower(byLabel);
  if (rows.length === 1) return `All ${plural(count, "exception")} fall under one ${by}: ${top.group}.`;
  return `${plural(count, "exception")} across ${plural(rows.length, by)}. The largest is ${top.group}: ${plural(top.count, "item")}${
    top.value ? `, ${money(top.value, currency)}` : ""
  } (${share}% of the ${total ? "value" : "items"}).`;
}

// ─── Emails ─────────────────────────────────────────────────────────────────

export const AUDIENCES: Record<Template["group"], { key: string; label: string }> = {
  marketplace: { key: "marketplace", label: "marketplace" },
  webstore: { key: "provider", label: "payment provider" },
  b2b: { key: "customer", label: "customer" },
  purchasing: { key: "supplier", label: "supplier" },
  payouts: { key: "provider", label: "provider" },
  custom: { key: "counterparty", label: "counterparty" },
};

export const AUDIENCE_LABELS: Record<string, string> = {
  marketplace: "marketplace",
  provider: "payment provider",
  customer: "customer",
  supplier: "supplier",
  courier: "courier",
  counterparty: "counterparty",
};

export const EMAIL_ROWS = 15;

/** The aggregated facts an email is written from: one check's totals and its largest items. */
export function emailFacts(t: Template, r: ReconResult, checkId: string): string {
  const c = r.checks.find((x) => x.id === checkId);
  const check = t.checks.find((x) => x.id === checkId);
  if (!c || !check) return "";
  const top = topExceptions(r, EMAIL_ROWS, checkId);
  return [
    `Issue: ${c.label}`,
    `What it means: ${check.description}`,
    `Items: ${c.count}`,
    `Total value: ${c.value.toFixed(2)} ${r.currency ?? ""}`.trim(),
    `Period: data up to ${r.asOf}`,
    `Largest ${top.length} items:`,
    ["key", "our_value", "their_value", "difference", "note"].join("\t"),
    ...top.map((e) => [e.key, e.leftValue?.toFixed(2), e.rightValue?.toFixed(2), (e.diff ?? e.value).toFixed(2), e.note].map(cell).join("\t")),
  ].join("\n");
}

export function ruleEmail(t: Template, r: ReconResult, checkId: string, audience: string, company: string): { subject: string; body: string } {
  const c = r.checks.find((x) => x.id === checkId)!;
  const check = t.checks.find((x) => x.id === checkId);
  const top = topExceptions(r, EMAIL_ROWS, checkId);
  const lines = top.map((e) => {
    const parts = [e.key];
    if (e.leftValue !== undefined && e.rightValue !== undefined) parts.push(`ours ${money(e.leftValue)}, yours ${money(e.rightValue)}`);
    else if (e.value) parts.push(money(Math.abs(e.value), r.currency));
    if (e.note) parts.push(e.note);
    return `- ${parts.join(" · ")}`;
  });
  const more = c.count > top.length ? `\n\nThere are ${c.count - top.length} more; the full list is attached.` : "";
  return {
    subject: `Reconciliation query: ${c.label} (${plural(c.count, "item")}${c.value ? `, ${money(c.value, r.currency)}` : ""})`,
    body: `Dear ${AUDIENCE_LABELS[audience] ?? audience} team,

While reconciling our records up to ${r.asOf}, we found ${plural(c.count, "item")}${c.value ? ` worth ${money(c.value, r.currency)}` : ""} under "${c.label}". ${check?.description ?? ""}

The largest items are:
${lines.join("\n")}${more}

Please review these and confirm the correct position, or let us know when the difference will be settled.

Kind regards,
${company}`,
  };
}

// ─── Explaining one exception ───────────────────────────────────────────────

/** One exception with the mapped fields of its rows (a few rows only) for an explanation. */
export function exceptionFacts(t: Template, r: ReconResult, index: number, datasets: Map<string, Dataset>): string | undefined {
  const e = r.exceptions[index];
  if (!e) return undefined;
  const check = t.checks.find((c) => c.id === e.check);
  const rows = indexDatasets(datasets);
  const describe = (ref: ReconException["left"]) => {
    if (!ref) return [];
    const slot = t.sources.find((s) => s.key === ref.slot);
    return ref.rows.slice(0, 3).flatMap((n) => {
      const rec = rows.get(ref.slot)?.get(n);
      if (!rec || !slot) return [];
      const values = slot.fields.filter((f) => rec.raw[f.key]).map((f) => `${f.label}=${cell(rec.raw[f.key])}`);
      return [`${slot.label} row ${n}: ${values.join("; ")}`];
    });
  };
  return [
    `Check: ${check?.label ?? e.check}`,
    `What it checks: ${check?.description ?? ""}`,
    `Key: ${e.key}`,
    e.leftValue !== undefined ? `Left value: ${e.leftValue.toFixed(2)}` : "",
    e.rightValue !== undefined ? `Right value: ${e.rightValue.toFixed(2)}` : "",
    e.diff !== undefined ? `Difference (left minus right): ${e.diff.toFixed(2)}` : "",
    `At risk: ${Math.abs(e.value).toFixed(2)} ${r.currency ?? ""}`.trim(),
    e.note ? `Note: ${e.note}` : "",
    ...describe(e.left),
    ...describe(e.right),
    ...(e.left && e.left.rows.length > 3 ? [`(${e.left.rows.length} rows on the left in total)`] : []),
  ]
    .filter(Boolean)
    .join("\n");
}

export function ruleExplanation(t: Template, r: ReconResult, index: number): string {
  const e = r.exceptions[index];
  const check = t.checks.find((c) => c.id === e?.check);
  if (!e || !check) return "I couldn't find that exception. Run the reconciliation again and retry.";
  const link = "link" in (check.rule ?? {}) && check.rule && "link" in check.rule ? t.links[check.rule.link] : undefined;
  const L = link ? slotLabel(t, link.left) : "left file";
  const R = link ? slotLabel(t, link.right) : "right file";
  let text = `${e.key} was flagged by "${check.label}". ${check.description}`;
  if (e.leftValue !== undefined && e.rightValue !== undefined) {
    text += ` Your ${L.toLowerCase()} shows ${money(e.leftValue, r.currency)} and the ${R.toLowerCase()} shows ${money(e.rightValue, r.currency)}, a difference of ${money(Math.abs(e.diff ?? e.leftValue - e.rightValue), r.currency)}.`;
  } else if (e.value) text += ` ${money(Math.abs(e.value), r.currency)} is at risk.`;
  if (e.note) text += ` (${e.note})`;
  return `${text} Next: ${fixAction(t, check)}`;
}
