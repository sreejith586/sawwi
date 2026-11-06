import type { CheckRule } from "@/lib/templates/types";

/**
 * How serious a finding is, for color coding: "high" means money is missing or wrong,
 * "medium" means timing or ageing that needs follow-up, "info" is for planning.
 */
export type Severity = "high" | "medium" | "info";

export function severityOf(rule: CheckRule | undefined): Severity {
  switch (rule?.kind) {
    case "older_than":
    case "date_outside":
    case "multi_value":
      return "medium";
    case "due_within":
      return "info";
    default:
      return "high";
  }
}
