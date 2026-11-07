// Client-safe search/filter keys for the import history table (no server imports).
export const SYNC_SEARCH = ["connection", "report", "error"] as const;
export const SYNC_FILTERS = ["status", "connection"];
