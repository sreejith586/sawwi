import type { KeyNormalizer } from "@/lib/templates/types";

export function normalizeKey(value: string, normalizers: KeyNormalizer[]): string {
  let v = value;
  for (const n of normalizers) {
    if (n === "trim") v = v.trim();
    else if (n === "upper") v = v.toUpperCase();
    else if (n === "strip_non_alnum") v = v.replace(/[^\p{L}\p{N}]/gu, "");
    else if (n === "strip_leading_zeros") v = v.replace(/^0+(?=.)/, "");
  }
  return v;
}

export type KeyOverlap = {
  /** Share of left keys found on the right, with the template's normalizers. */
  overlap: number;
  /** Extra normalizers that would raise the overlap, if any help. */
  suggestion?: { normalizers: KeyNormalizer[]; overlap: number; leftExample: string; rightExample: string };
};

/** Share of left keys that appear inside some right value (both normalized). */
export function containmentOverlap(leftRaw: string[], rightRaw: string[], normalizers: KeyNormalizer[]): number {
  const left = [...new Set(leftRaw.map((v) => normalizeKey(v, normalizers)).filter((v) => v.length >= 3))].slice(0, 2000);
  if (left.length === 0) return 0;
  const haystack = rightRaw.map((v) => normalizeKey(v, normalizers)).join("\u0000");
  return left.filter((k) => haystack.includes(k)).length / left.length;
}

const EXTRA_OPTIONS: KeyNormalizer[][] = [
  ["strip_non_alnum"],
  ["strip_leading_zeros"],
  ["strip_non_alnum", "strip_leading_zeros"],
];

function overlapOf(left: string[], rightSet: Set<string>, normalizers: KeyNormalizer[]): number {
  const keys = left.map((v) => normalizeKey(v, normalizers)).filter(Boolean);
  if (keys.length === 0) return 0;
  return keys.filter((k) => rightSet.has(k)).length / keys.length;
}

/**
 * Compares join keys across two files. Low overlap with a clear fix (e.g. `#1001` vs `1001`)
 * becomes a yes/no question instead of a silent mass mismatch.
 */
export function checkKeyOverlap(leftRaw: string[], rightRaw: string[], base: KeyNormalizer[]): KeyOverlap {
  const left = [...new Set(leftRaw.filter((v) => v.trim()))].slice(0, 5000);
  const right = [...new Set(rightRaw.filter((v) => v.trim()))];
  const baseRight = new Set(right.map((v) => normalizeKey(v, base)));
  const overlap = overlapOf(left, baseRight, base);
  if (overlap >= 0.5 || left.length === 0 || right.length === 0) return { overlap };

  let best: KeyOverlap["suggestion"];
  for (const extra of EXTRA_OPTIONS) {
    const normalizers = [...new Set([...base, ...extra])];
    const rightIndex = new Map(right.map((v) => [normalizeKey(v, normalizers), v]));
    const score = overlapOf(left, new Set(rightIndex.keys()), normalizers);
    if (score >= Math.max(0.5, overlap * 2) && (!best || score > best.overlap + 0.05)) {
      const leftExample = left.find((v) => {
        const k = normalizeKey(v, normalizers);
        return rightIndex.has(k) && rightIndex.get(k) !== v && !baseRight.has(normalizeKey(v, base));
      });
      if (leftExample) {
        best = {
          normalizers,
          overlap: score,
          leftExample,
          rightExample: rightIndex.get(normalizeKey(leftExample, normalizers))!,
        };
      }
    }
  }
  return { overlap, suggestion: best };
}
