import { describe, expect, it } from "vitest";
import { getDb, toPositional } from "./db";

describe("database layer (D-37)", () => {
  it("numbers ? placeholders, leaving quoted text alone", () => {
    expect(toPositional("SELECT * FROM t WHERE a = ? AND b = ?")).toBe("SELECT * FROM t WHERE a = $1 AND b = $2");
    expect(toPositional(`SELECT '?' AS q, "we?ird" FROM t WHERE c = ?`)).toBe(`SELECT '?' AS q, "we?ird" FROM t WHERE c = $1`);
  });

  it("creates the schema once and records the migration", async () => {
    const db = getDb();
    const applied = await db.all<{ id: number }>("SELECT id FROM schema_migrations ORDER BY id");
    expect(applied.map((m) => m.id)).toEqual([1, 2, 3]);
    const tables = await db.all<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()");
    expect(tables.map((t) => t.table_name)).toEqual(expect.arrayContaining(["runs", "orgs", "members", "connections", "demo_state", "jobs"]));
  });

  it("returns counts as numbers and reports changed rows", async () => {
    const db = getDb();
    await db.run("INSERT INTO demo_state (key, value) VALUES (?, ?), (?, ?)", "a", "1", "b", "2");
    expect(await db.get("SELECT COUNT(*) AS n FROM demo_state")).toEqual({ n: 2 });
    expect(await db.run("DELETE FROM demo_state WHERE key = ?", "a")).toEqual({ changes: 1 });
  });

  it("rolls a transaction back when it throws", async () => {
    const db = getDb();
    await expect(
      db.tx(async (t) => {
        await t.run("INSERT INTO demo_state (key, value) VALUES (?, ?)", "c", "3");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await db.get("SELECT value FROM demo_state WHERE key = ?", "c")).toBeUndefined();
    await db.tx((t) => t.run("INSERT INTO demo_state (key, value) VALUES (?, ?)", "c", "3"));
    expect(await db.get("SELECT value FROM demo_state WHERE key = ?", "c")).toEqual({ value: "3" });
  });
});
