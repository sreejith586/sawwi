import { normalizeHeader, type ColumnProfile } from "@/lib/files/profile";
import type { CanonicalField } from "@/lib/templates/types";
import { ALIASES } from "./aliases";

export type Candidate = { field: string; column: string; score: number };

/** Above this, a heuristic match is accepted without asking. */
export const AUTO_ACCEPT = 0.85;
/** Between this and AUTO_ACCEPT, Sawwina asks a yes/no confirmation. */
export const CONFIRM_FLOOR = 0.55;

function bigrams(s: string): string[] {
  const t = s.replace(/\s+/g, "");
  return Array.from({ length: Math.max(0, t.length - 1) }, (_, i) => t.slice(i, i + 2));
}

function dice(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.length || !B.length) return a === b ? 1 : 0;
  const counts = new Map<string, number>();
  for (const g of A) counts.set(g, (counts.get(g) ?? 0) + 1);
  let overlap = 0;
  for (const g of B) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      overlap++;
      counts.set(g, c - 1);
    }
  }
  return (2 * overlap) / (A.length + B.length);
}

function nameScore(header: string, field: CanonicalField): number {
  const h = normalizeHeader(header);
  const names = [field.key.replace(/_/g, " "), normalizeHeader(field.label), ...(ALIASES[field.key] ?? []).map(normalizeHeader)];
  let best = 0;
  for (const [i, n] of names.entries()) {
    // Earlier aliases win ties, e.g. "Grand Total (Purchased)" over "Grand Total (Base)".
    if (h === n) return 1 - i * 0.001;
    const hTokens = new Set(h.split(" "));
    const nTokens = n.split(" ");
    if (nTokens.length > 1 && nTokens.every((t) => hTokens.has(t))) best = Math.max(best, 0.88);
    best = Math.max(best, dice(h, n) * 0.8);
  }
  return best;
}

/** Penalizes matches whose data can't hold the field's type (e.g. text column as an amount). */
function typeFit(column: ColumnProfile, field: CanonicalField): number {
  if (column.kind === "empty") return 0.5;
  switch (field.type) {
    case "money":
    case "number":
    case "percent":
      return column.kind === "number" ? 1 : 0.3;
    case "date":
      return column.kind === "date" ? 1 : 0.3;
    case "id":
      return column.kind === "id" || column.kind === "text" || (column.kind === "number" && !column.hasDecimals) ? 1 : 0.4;
    case "text":
      return column.kind === "text" || column.kind === "id" ? 1 : 0.6;
  }
}

export function scoreCandidates(fields: CanonicalField[], columns: ColumnProfile[]): Candidate[] {
  const out: Candidate[] = [];
  for (const field of fields) {
    for (const column of columns) {
      const score = nameScore(column.name, field) * typeFit(column, field);
      if (score > 0.3) out.push({ field: field.key, column: column.name, score: Math.round(score * 1000) / 1000 });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Greedy one-to-one assignment: best scores first, each column used at most once. */
export function assign(candidates: Candidate[], taken: Set<string> = new Set()): Map<string, Candidate> {
  const result = new Map<string, Candidate>();
  const used = new Set(taken);
  for (const c of candidates) {
    if (result.has(c.field) || used.has(c.column)) continue;
    result.set(c.field, c);
    used.add(c.column);
  }
  return result;
}
