import { rmSync } from "node:fs";
import path from "node:path";
import { dataDir, getDb } from "@/lib/db";

// SQL for the demo store's daily reset (D-32). The wipe is generic: every table with a run_id
// column loses the demo's runs' rows, and every table with an org_key column loses the demo's
// rows, so tables added later are covered without a change here. Only the demo key is touched.

export function getDemoState(key: string): string | undefined {
  const r = getDb().prepare("SELECT value FROM demo_state WHERE key = ?").get(key) as { value: string } | undefined;
  return r?.value;
}

export function setDemoState(key: string, value: string) {
  getDb().prepare("INSERT INTO demo_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

function columnsOf(table: string): Set<string> {
  return new Set((getDb().prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((c) => c.name));
}

/** Deletes everything filed under this org key, and its runs' uploaded files. Returns rows removed per table. */
export function wipeOrgData(orgKey: string): Record<string, number> {
  const db = getDb();
  const runIds = (db.prepare("SELECT id FROM runs WHERE org_key = ?").all(orgKey) as { id: string }[]).map((r) => r.id);
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
  const removed: Record<string, number> = {};
  db.exec("BEGIN");
  try {
    for (const t of tables) {
      if (t === "runs" || !columnsOf(t).has("run_id")) continue;
      const r = db.prepare(`DELETE FROM "${t}" WHERE run_id IN (SELECT id FROM runs WHERE org_key = ?)`).run(orgKey);
      if (r.changes) removed[t] = Number(r.changes);
    }
    for (const t of tables) {
      if (!columnsOf(t).has("org_key")) continue;
      const r = db.prepare(`DELETE FROM "${t}" WHERE org_key = ?`).run(orgKey);
      if (r.changes) removed[t] = Number(r.changes);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  for (const id of runIds) rmSync(path.join(dataDir(), "uploads", id), { recursive: true, force: true });
  return removed;
}
