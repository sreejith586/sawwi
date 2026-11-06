// Client-safe search/filter keys for the schedules table (no server imports).
export const SCHEDULE_SEARCH = ["template", "group", "cadence"] as const;
export const SCHEDULE_FILTERS = ["status", "group"];
