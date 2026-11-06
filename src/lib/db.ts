import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

// Local development store (Node's built-in SQLite). It moves to Postgres with auth;
// keep all SQL inside src/lib/runs/store.ts so that swap stays contained.

export function dataDir(): string {
  return process.env.SAWWI_DATA_DIR ?? path.join(process.cwd(), ".data");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  org_key TEXT NOT NULL,
  template_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run_files (
  run_id TEXT NOT NULL,
  slot_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  mapping_json TEXT NOT NULL,
  PRIMARY KEY (run_id, slot_key)
);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  slot_key TEXT,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  answer_json TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  question_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mapping_cache (
  org_key TEXT NOT NULL,
  template_id TEXT NOT NULL,
  slot_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  mapping_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (org_key, template_id, slot_key, fingerprint)
);
CREATE TABLE IF NOT EXISTS template_rules (
  org_key TEXT NOT NULL,
  template_id TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  PRIMARY KEY (org_key, template_id, rule_key)
);
CREATE TABLE IF NOT EXISTS run_checks (
  run_id TEXT NOT NULL,
  check_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  PRIMARY KEY (run_id, check_key)
);
CREATE TABLE IF NOT EXISTS run_results (
  run_id TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pdf_layouts (
  org_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  issuer_key TEXT NOT NULL,
  recipe_json TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (org_key, fingerprint)
);
CREATE INDEX IF NOT EXISTS pdf_layouts_issuer ON pdf_layouts (org_key, issuer_key);
CREATE TABLE IF NOT EXISTS llm_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT,
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run_narratives (
  run_id TEXT PRIMARY KEY,
  result_at TEXT NOT NULL,
  source TEXT NOT NULL,
  body_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS custom_templates (
  id TEXT PRIMARY KEY,
  org_key TEXT NOT NULL,
  template_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

/** Columns added after a table first shipped: CREATE TABLE IF NOT EXISTS won't add them to old databases. */
const COLUMNS: [table: string, column: string, type: string][] = [["messages", "payload_json", "TEXT"]];

function migrate(d: DatabaseSync) {
  for (const [table, column, type] of COLUMNS) {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

let db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (!db) {
    mkdirSync(dataDir(), { recursive: true });
    db = new DatabaseSync(path.join(dataDir(), "sawwi.db"));
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(SCHEMA);
    migrate(db);
  }
  return db;
}
