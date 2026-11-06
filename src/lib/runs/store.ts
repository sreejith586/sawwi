import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import type { LlmUsage } from "@/lib/mapping/llm";
import type { ReconResult } from "@/lib/recon/match";
import type { Message, Question, QuestionPayload, Run, RunFile, RunStatus, SlotMapping } from "./types";

// All SQL lives here, so moving from SQLite to Postgres touches one file.

type Row = Record<string, string | number | null>;
const now = () => new Date().toISOString();

export function createRun(orgKey: string, templateId: string): Run {
  const run: Run = { id: randomUUID(), orgKey, templateId, status: "collecting", createdAt: now() };
  getDb()
    .prepare("INSERT INTO runs (id, org_key, template_id, status, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(run.id, run.orgKey, run.templateId, run.status, run.createdAt);
  return run;
}

export function getRun(id: string): Run | undefined {
  const r = getDb().prepare("SELECT * FROM runs WHERE id = ?").get(id) as Row | undefined;
  if (!r) return undefined;
  return {
    id: String(r.id),
    orgKey: String(r.org_key),
    templateId: String(r.template_id),
    status: r.status as RunStatus,
    createdAt: String(r.created_at),
  };
}

export function setRunStatus(id: string, status: RunStatus) {
  getDb().prepare("UPDATE runs SET status = ? WHERE id = ?").run(status, id);
}

export function upsertRunFile(runId: string, file: RunFile) {
  getDb()
    .prepare(
      `INSERT INTO run_files (run_id, slot_key, file_name, stored_path, fingerprint, profile_json, mapping_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (run_id, slot_key) DO UPDATE SET
         file_name = excluded.file_name, stored_path = excluded.stored_path, fingerprint = excluded.fingerprint,
         profile_json = excluded.profile_json, mapping_json = excluded.mapping_json`,
    )
    .run(
      runId,
      file.slotKey,
      file.fileName,
      file.storedPath,
      file.profile.fingerprint,
      JSON.stringify(file.profile),
      JSON.stringify(file.mapping),
    );
}

export function updateRunFileMapping(runId: string, slotKey: string, mapping: SlotMapping) {
  getDb()
    .prepare("UPDATE run_files SET mapping_json = ? WHERE run_id = ? AND slot_key = ?")
    .run(JSON.stringify(mapping), runId, slotKey);
}

export function getRunFiles(runId: string): RunFile[] {
  const rows = getDb().prepare("SELECT * FROM run_files WHERE run_id = ?").all(runId) as Row[];
  return rows.map((r) => ({
    slotKey: String(r.slot_key),
    fileName: String(r.file_name),
    storedPath: String(r.stored_path),
    profile: JSON.parse(String(r.profile_json)),
    mapping: JSON.parse(String(r.mapping_json)),
  }));
}

export function addQuestion(runId: string, slotKey: string | null, payload: QuestionPayload): Question {
  const db = getDb();
  const seq = ((db.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM questions WHERE run_id = ?").get(runId) as Row).m as number) + 1;
  const q: Question = { id: randomUUID(), seq, slotKey, payload, answer: null };
  db.prepare("INSERT INTO questions (id, run_id, seq, slot_key, kind, payload_json) VALUES (?, ?, ?, ?, ?, ?)").run(
    q.id,
    runId,
    seq,
    slotKey,
    payload.kind,
    JSON.stringify(payload),
  );
  return q;
}

/** Drops unanswered questions for a slot, e.g. when the user replaces its file. */
export function deleteOpenQuestions(runId: string, slotKey: string) {
  getDb().prepare("DELETE FROM questions WHERE run_id = ? AND slot_key = ? AND answer_json IS NULL").run(runId, slotKey);
}

export function getQuestions(runId: string): Question[] {
  const rows = getDb().prepare("SELECT * FROM questions WHERE run_id = ? ORDER BY seq").all(runId) as Row[];
  return rows.map((r) => ({
    id: String(r.id),
    seq: Number(r.seq),
    slotKey: r.slot_key === null ? null : String(r.slot_key),
    payload: JSON.parse(String(r.payload_json)),
    answer: r.answer_json === null ? null : JSON.parse(String(r.answer_json)),
  }));
}

export function setAnswer(questionId: string, answer: string) {
  getDb().prepare("UPDATE questions SET answer_json = ? WHERE id = ?").run(JSON.stringify(answer), questionId);
}

export function addMessage(runId: string, role: Message["role"], body: string, questionId: string | null = null) {
  getDb()
    .prepare("INSERT INTO messages (run_id, role, body, question_id, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(runId, role, body, questionId, now());
}

export function getMessages(runId: string): Message[] {
  const rows = getDb().prepare("SELECT * FROM messages WHERE run_id = ? ORDER BY id").all(runId) as Row[];
  return rows.map((r) => ({
    id: Number(r.id),
    role: r.role as Message["role"],
    body: String(r.body),
    questionId: r.question_id === null ? null : String(r.question_id),
  }));
}

export function getCachedMapping(orgKey: string, templateId: string, slotKey: string, fingerprint: string): SlotMapping | undefined {
  const r = getDb()
    .prepare("SELECT mapping_json FROM mapping_cache WHERE org_key = ? AND template_id = ? AND slot_key = ? AND fingerprint = ?")
    .get(orgKey, templateId, slotKey, fingerprint) as Row | undefined;
  return r ? JSON.parse(String(r.mapping_json)) : undefined;
}

export function saveCachedMapping(orgKey: string, templateId: string, slotKey: string, fingerprint: string, mapping: SlotMapping) {
  getDb()
    .prepare(
      `INSERT INTO mapping_cache (org_key, template_id, slot_key, fingerprint, mapping_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (org_key, template_id, slot_key, fingerprint) DO UPDATE SET mapping_json = excluded.mapping_json, updated_at = excluded.updated_at`,
    )
    .run(orgKey, templateId, slotKey, fingerprint, JSON.stringify(mapping), now());
}

export function getRule<T>(orgKey: string, templateId: string, ruleKey: string): T | undefined {
  const r = getDb()
    .prepare("SELECT value_json FROM template_rules WHERE org_key = ? AND template_id = ? AND rule_key = ?")
    .get(orgKey, templateId, ruleKey) as Row | undefined;
  return r ? (JSON.parse(String(r.value_json)) as T) : undefined;
}

export function setRule(orgKey: string, templateId: string, ruleKey: string, value: unknown) {
  getDb()
    .prepare(
      `INSERT INTO template_rules (org_key, template_id, rule_key, value_json) VALUES (?, ?, ?, ?)
       ON CONFLICT (org_key, template_id, rule_key) DO UPDATE SET value_json = excluded.value_json`,
    )
    .run(orgKey, templateId, ruleKey, JSON.stringify(value));
}

export function saveResult(runId: string, result: ReconResult) {
  getDb()
    .prepare(
      `INSERT INTO run_results (run_id, result_json, created_at) VALUES (?, ?, ?)
       ON CONFLICT (run_id) DO UPDATE SET result_json = excluded.result_json, created_at = excluded.created_at`,
    )
    .run(runId, JSON.stringify(result), now());
}

export function getResult(runId: string): (ReconResult & { createdAt: string }) | undefined {
  const r = getDb().prepare("SELECT result_json, created_at FROM run_results WHERE run_id = ?").get(runId) as Row | undefined;
  return r ? { ...JSON.parse(String(r.result_json)), createdAt: String(r.created_at) } : undefined;
}

/** Results go stale the moment a file, mapping or answer changes. */
export function clearResult(runId: string) {
  getDb().prepare("DELETE FROM run_results WHERE run_id = ?").run(runId);
}

export function getRunCheck<T>(runId: string, checkKey: string): T | undefined {
  const r = getDb().prepare("SELECT value_json FROM run_checks WHERE run_id = ? AND check_key = ?").get(runId, checkKey) as Row | undefined;
  return r ? (JSON.parse(String(r.value_json)) as T) : undefined;
}

export function setRunCheck(runId: string, checkKey: string, value: unknown) {
  getDb()
    .prepare(
      `INSERT INTO run_checks (run_id, check_key, value_json) VALUES (?, ?, ?)
       ON CONFLICT (run_id, check_key) DO UPDATE SET value_json = excluded.value_json`,
    )
    .run(runId, checkKey, JSON.stringify(value));
}

export function logUsage(runId: string | null, purpose: string, usage: LlmUsage) {
  getDb()
    .prepare(
      `INSERT INTO llm_usage (run_id, purpose, model, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(runId, purpose, usage.model, usage.inputTokens, usage.cacheReadTokens, usage.cacheWriteTokens, usage.outputTokens, now());
}

export type UsageSummary = { calls: number; inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number };

export function getUsage(runId: string): UsageSummary {
  const r = getDb()
    .prepare(
      `SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(cache_read_tokens),0) AS cr,
              COALESCE(SUM(cache_write_tokens),0) AS cw, COALESCE(SUM(output_tokens),0) AS o
       FROM llm_usage WHERE run_id = ?`,
    )
    .get(runId) as Row;
  return {
    calls: Number(r.calls),
    inputTokens: Number(r.i),
    cacheReadTokens: Number(r.cr),
    cacheWriteTokens: Number(r.cw),
    outputTokens: Number(r.o),
  };
}
