// Cell formatting shared by connectors: every pulled value becomes text, as in a CSV export.

export const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/**
 * Decimal amounts and quantities with at least 2 places ("7350.00"), up to 5. Whole numbers
 * would otherwise look like IDs to the file profiler on small pulls (D-29).
 */
export function num(v: unknown): string {
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return num(Number(v));
  if (typeof v !== "number" || !Number.isFinite(v)) return str(v);
  const s = v.toFixed(5).replace(/0+$/, "");
  const [whole, frac = ""] = s.split(".");
  return `${whole}.${frac.padEnd(2, "0")}`;
}
