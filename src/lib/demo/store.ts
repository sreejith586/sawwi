import { rmSync } from "node:fs";
import path from "node:path";
import { dataDir, getDb } from "@/lib/db";

// SQL for the demo store's daily reset (D-32). The wipe is generic: every table with a run_id
// column loses the demo's runs' rows, and every table with an org_key column loses the demo's
// rows, so tables added later are covered without a change here. Only the demo key is touched.

export async function getDemoState(key: string): Promise<string | undefined> {
  const r = await getDb().get<{ value: string }>("SELECT value FROM demo_state WHERE key = ?", key);
  return r?.value;
}

export async function setDemoState(key: string, value: string) {
  await getDb().run("INSERT INTO demo_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", key, value);
}

/** Deletes everything filed under this org key, and its runs' uploaded files. Returns rows removed per table. */
export async function wipeOrgData(orgKey: string): Promise<Record<string, number>> {
  const db = getDb();
  const runIds = (await db.all<{ id: string }>("SELECT id FROM runs WHERE org_key = ?", orgKey)).map((r) => r.id);
  const cols = await db.all<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND column_name IN ('run_id', 'org_key') ORDER BY table_name`,
  );
  const withColumn = (c: string) => cols.filter((r) => r.column_name === c).map((r) => r.table_name);
  const removed: Record<string, number> = {};
  await db.tx(async (t) => {
    for (const table of withColumn("run_id")) {
      if (table === "runs") continue;
      const r = await t.run(`DELETE FROM "${table}" WHERE run_id IN (SELECT id FROM runs WHERE org_key = ?)`, orgKey);
      if (r.changes) removed[table] = r.changes;
    }
    for (const table of withColumn("org_key")) {
      const r = await t.run(`DELETE FROM "${table}" WHERE org_key = ?`, orgKey);
      if (r.changes) removed[table] = r.changes;
    }
  });
  for (const id of runIds) rmSync(path.join(dataDir(), "uploads", id), { recursive: true, force: true });
  return removed;
}
