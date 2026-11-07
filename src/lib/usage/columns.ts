import type { UsageView } from "./aggregate";

// Client-safe search/filter keys for the usage tables (no server imports), shared by
// the screen and the Excel export so a download matches what the table shows.
export const USAGE_SEARCH = ["label", "detail", "workspace"] as const;

export function usageFilters(view: UsageView, admin: boolean): string[] {
  if (view === "run") return admin ? ["detail", "workspace"] : ["detail"];
  return [];
}
