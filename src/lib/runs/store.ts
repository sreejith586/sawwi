import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import type { LlmUsage } from "@/lib/mapping/llm";
import type { LayoutRecipe, PdfFileInfo } from "@/lib/pdf/types";
import type { ReconResult } from "@/lib/recon/match";
import type { Template } from "@/lib/templates/types";
import type { ChatPayload, Message, Question, QuestionPayload, Run, RunFile, RunStatus, SlotMapping } from "./types";

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

export function deleteQuestion(id: string) {
  getDb().prepare("DELETE FROM questions WHERE id = ? AND answer_json IS NULL").run(id);
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

export function addMessage(runId: string, role: Message["role"], body: string, questionId: string | null = null, payload?: ChatPayload) {
  getDb()
    .prepare("INSERT INTO messages (run_id, role, body, question_id, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)")
    .run(runId, role, body, questionId, now(), payload ? JSON.stringify(payload) : null);
}

export function getMessages(runId: string): Message[] {
  const rows = getDb().prepare("SELECT * FROM messages WHERE run_id = ? ORDER BY id").all(runId) as Row[];
  return rows.map((r) => ({
    id: Number(r.id),
    role: r.role as Message["role"],
    body: String(r.body),
    questionId: r.question_id === null ? null : String(r.question_id),
    ...(r.payload_json ? { payload: JSON.parse(String(r.payload_json)) as ChatPayload } : {}),
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

/** PDF layout recipes per workspace, newest first: a repeat statement from the same issuer reuses its recipe. */
export function getPdfLayouts(orgKey: string, issuerKey: string): LayoutRecipe[] {
  const rows = getDb()
    .prepare("SELECT recipe_json FROM pdf_layouts WHERE org_key = ? AND issuer_key = ? ORDER BY updated_at DESC LIMIT 5")
    .all(orgKey, issuerKey) as Row[];
  return rows.map((r) => JSON.parse(String(r.recipe_json)));
}

export function savePdfLayout(orgKey: string, recipe: LayoutRecipe) {
  getDb()
    .prepare(
      `INSERT INTO pdf_layouts (org_key, fingerprint, issuer_key, recipe_json, uses, updated_at) VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT (org_key, fingerprint) DO UPDATE SET recipe_json = excluded.recipe_json, uses = uses + 1, updated_at = excluded.updated_at`,
    )
    .run(orgKey, recipe.fingerprint, recipe.issuerKey, JSON.stringify(recipe), now());
}

/** How a slot's PDF(s) were read: metadata and pre-match checks. Kept with the run's other checks. */
export function setPdfInfo(runId: string, slotKey: string, info: PdfFileInfo[] | null) {
  setRunCheck(runId, `pdf_${slotKey}`, info);
}

export function getPdfInfo(runId: string, slotKey: string): PdfFileInfo[] | undefined {
  return getRunCheck<PdfFileInfo[] | null>(runId, `pdf_${slotKey}`) ?? undefined;
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
  getDb().prepare("DELETE FROM run_narratives WHERE run_id = ?").run(runId);
}

// ─── Narrative cache: one per result, so re-opening a run never spends tokens ─────

export function getNarrative<T>(runId: string, resultAt: string): { source: string; body: T } | undefined {
  const r = getDb().prepare("SELECT source, body_json FROM run_narratives WHERE run_id = ? AND result_at = ?").get(runId, resultAt) as Row | undefined;
  return r ? { source: String(r.source), body: JSON.parse(String(r.body_json)) as T } : undefined;
}

export function saveNarrative(runId: string, resultAt: string, source: string, body: unknown) {
  getDb()
    .prepare(
      `INSERT INTO run_narratives (run_id, result_at, source, body_json, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (run_id) DO UPDATE SET result_at = excluded.result_at, source = excluded.source, body_json = excluded.body_json, created_at = excluded.created_at`,
    )
    .run(runId, resultAt, source, JSON.stringify(body), now());
}

// ─── Workspace templates (saved from a generic two-file reconciliation) ───────────

export function saveCustomTemplate(orgKey: string, template: Template) {
  getDb()
    .prepare("INSERT INTO custom_templates (id, org_key, template_json, created_at) VALUES (?, ?, ?, ?)")
    .run(template.id, orgKey, JSON.stringify(template), now());
}

export function getCustomTemplate(orgKey: string, id: string): Template | undefined {
  const r = getDb().prepare("SELECT template_json FROM custom_templates WHERE id = ? AND org_key = ?").get(id, orgKey) as Row | undefined;
  return r ? (JSON.parse(String(r.template_json)) as Template) : undefined;
}

export function listCustomTemplates(orgKey: string): Template[] {
  const rows = getDb().prepare("SELECT template_json FROM custom_templates WHERE org_key = ? ORDER BY created_at DESC").all(orgKey) as Row[];
  return rows.map((r) => JSON.parse(String(r.template_json)) as Template);
}

export function deleteCustomTemplate(orgKey: string, id: string) {
  getDb().prepare("DELETE FROM custom_templates WHERE id = ? AND org_key = ?").run(id, orgKey);
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

export type RunSummary = Run & {
  files: number;
  ranAt?: string;
  exceptions?: number;
  value?: number;
  currency?: string;
};

/** Every run for an org, newest first, with headline result numbers (read straight from JSON, no full parse). */
export function listRuns(orgKey: string): RunSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT r.id, r.org_key, r.template_id, r.status, r.created_at,
              (SELECT COUNT(*) FROM run_files f WHERE f.run_id = r.id) AS files,
              rr.created_at AS ran_at,
              json_extract(rr.result_json, '$.totals.exceptions') AS exceptions,
              json_extract(rr.result_json, '$.totals.value') AS value,
              json_extract(rr.result_json, '$.currency') AS currency
       FROM runs r LEFT JOIN run_results rr ON rr.run_id = r.id
       WHERE r.org_key = ? ORDER BY r.created_at DESC`,
    )
    .all(orgKey) as Row[];
  return rows.map((r) => ({
    id: String(r.id),
    orgKey: String(r.org_key),
    templateId: String(r.template_id),
    status: r.status as RunStatus,
    createdAt: String(r.created_at),
    files: Number(r.files),
    ranAt: r.ran_at === null ? undefined : String(r.ran_at),
    exceptions: r.exceptions === null ? undefined : Number(r.exceptions),
    value: r.value === null ? undefined : Number(r.value),
    currency: r.currency === null ? undefined : String(r.currency),
  }));
}

// ─── Usage dashboard (Phase 6) ────────────────────────────────────────────────────

export type UsageRecord = {
  runId: string | null;
  orgKey: string | null;
  orgName: string | null;
  templateId: string | null;
  runStartedAt: string | null;
  purpose: string;
  model: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  createdAt: string;
};

/**
 * Every logged LLM call, oldest first, for one workspace (orgKey) or all of them (null,
 * superadmin only). A call belongs to the workspace of its run. Only the all-workspaces
 * query joins `orgs` (created by the SaaS store), for the workspace name.
 */
export function listUsageRecords(orgKey: string | null, since?: string): UsageRecord[] {
  const where: string[] = [];
  const args: string[] = [];
  if (orgKey !== null) {
    where.push("r.org_key = ?");
    args.push(orgKey);
  }
  if (since) {
    where.push("u.created_at >= ?");
    args.push(since);
  }
  const rows = getDb()
    .prepare(
      `SELECT u.run_id, r.org_key, ${orgKey !== null ? "NULL" : "o.name"} AS org_name, r.template_id, r.created_at AS run_started_at,
              u.purpose, u.model, u.input_tokens, u.cache_read_tokens, u.cache_write_tokens, u.output_tokens, u.created_at
       FROM llm_usage u
       ${orgKey !== null ? "JOIN" : "LEFT JOIN"} runs r ON r.id = u.run_id
       ${orgKey !== null ? "" : "LEFT JOIN orgs o ON o.key = r.org_key"}
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY u.created_at, u.id`,
    )
    .all(...args) as Row[];
  const str = (v: string | number | null) => (v === null ? null : String(v));
  return rows.map((r) => ({
    runId: str(r.run_id),
    orgKey: str(r.org_key),
    orgName: str(r.org_name),
    templateId: str(r.template_id),
    runStartedAt: str(r.run_started_at),
    purpose: String(r.purpose),
    model: String(r.model),
    inputTokens: Number(r.input_tokens),
    cacheReadTokens: Number(r.cache_read_tokens),
    cacheWriteTokens: Number(r.cache_write_tokens),
    outputTokens: Number(r.output_tokens),
    createdAt: String(r.created_at),
  }));
}

export type RunActivityRecord = {
  id: string;
  orgKey: string;
  templateId: string;
  createdAt: string;
  questions: number;
  mappingCalls: number;
  hasResult: boolean;
};

/** Every run (all history, for repeat detection) with how much it had to ask. */
export function listRunActivity(orgKey: string | null): RunActivityRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT r.id, r.org_key, r.template_id, r.created_at,
              (SELECT COUNT(*) FROM questions q WHERE q.run_id = r.id) AS questions,
              (SELECT COUNT(*) FROM llm_usage u WHERE u.run_id = r.id AND u.purpose = 'column_mapping') AS mapping_calls,
              EXISTS (SELECT 1 FROM run_results rr WHERE rr.run_id = r.id) AS has_result
       FROM runs r ${orgKey !== null ? "WHERE r.org_key = ?" : ""}`,
    )
    .all(...(orgKey !== null ? [orgKey] : [])) as Row[];
  return rows.map((r) => ({
    id: String(r.id),
    orgKey: String(r.org_key),
    templateId: String(r.template_id),
    createdAt: String(r.created_at),
    questions: Number(r.questions),
    mappingCalls: Number(r.mapping_calls),
    hasResult: Number(r.has_result) === 1,
  }));
}
