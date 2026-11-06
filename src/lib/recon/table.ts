// Shared by the report UI and the Excel export so a download is exactly what's on screen.

export type SortDir = "asc" | "desc";
export type TableQuery = { q?: string; sort?: string; dir?: SortDir; filters?: Record<string, string | undefined> };

export function applyQuery<T extends Record<string, unknown>>(rows: T[], query: TableQuery, searchFields: (keyof T)[]): T[] {
  const q = query.q?.trim().toLowerCase();
  let out = rows.filter((r) => {
    for (const [field, value] of Object.entries(query.filters ?? {})) {
      if (value && value !== "all" && String(r[field] ?? "") !== value) return false;
    }
    return !q || searchFields.some((f) => String(r[f] ?? "").toLowerCase().includes(q));
  });
  if (query.sort) {
    const key = query.sort;
    const sign = query.dir === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      const x = a[key];
      const y = b[key];
      if (x === undefined || x === null || x === "") return 1;
      if (y === undefined || y === null || y === "") return -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * sign;
      return String(x).localeCompare(String(y), undefined, { numeric: true }) * sign;
    });
  }
  return out;
}

export function queryFromParams(params: URLSearchParams, filterKeys: string[]): TableQuery {
  return {
    q: params.get("q") ?? undefined,
    sort: params.get("sort") ?? undefined,
    dir: params.get("dir") === "asc" ? "asc" : "desc",
    filters: Object.fromEntries(filterKeys.map((k) => [k, params.get(k) ?? undefined])),
  };
}

export function queryToParams(query: TableQuery): string {
  const p = new URLSearchParams();
  if (query.q) p.set("q", query.q);
  if (query.sort) p.set("sort", query.sort);
  if (query.dir) p.set("dir", query.dir);
  for (const [k, v] of Object.entries(query.filters ?? {})) if (v && v !== "all") p.set(k, v);
  return p.toString();
}
