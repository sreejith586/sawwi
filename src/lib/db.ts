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
`;

let db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (!db) {
    mkdirSync(dataDir(), { recursive: true });
    db = new DatabaseSync(path.join(dataDir(), "sawwi.db"));
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(SCHEMA);
  }
  return db;
}
