import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import type { LlmUsage } from "@/lib/mapping/llm";
import type { LayoutRecipe, PdfFileInfo } from "@/lib/pdf/types";
import type { ReconResult } from "@/lib/recon/match";
import type { Template } from "@/lib/templates/types";
import type { ChatPayload, Message, Question, QuestionPayload, Run, RunFile, RunStatus, SlotMapping } from "./types";

// All SQL for runs lives here (Postgres, D-37); tables are created in src/lib/db.ts.

type Row = Record<string, string | number | null>;
const now = () => new Date().toISOString();

export async function createRun(orgKey: string, templateId: string): Promise<Run> {
  const run: Run = { id: randomUUID(), orgKey, templateId, status: "collecting", createdAt: now() };
  await getDb().run("INSERT INTO runs (id, org_key, template_id, status, created_at) VALUES (?, ?, ?, ?, ?)", run.id, run.orgKey, run.templateId, run.status, run.createdAt);
  return run;
}

export async function getRun(id: string): Promise<Run | undefined> {
  const r = (await getDb().get("SELECT * FROM runs WHERE id = ?", id)) as Row | undefined;
  if (!r) return undefined;
  return {
    id: String(r.id),
    orgKey: String(r.org_key),
    templateId: String(r.template_id),
    status: r.status as RunStatus,
    createdAt: String(r.created_at),
  };
}

export async function setRunStatus(id: string, status: RunStatus) {
  await getDb().run("UPDATE runs SET status = ? WHERE id = ?", status, id);
}

export async function upsertRunFile(runId: string, file: RunFile) {
  (await getDb().run(`INSERT INTO run_files (run_id, slot_key, file_name, stored_path, fingerprint, profile_json, mapping_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (run_id, slot_key) DO UPDATE SET
         file_name = excluded.file_name, stored_path = excluded.stored_path, fingerprint = excluded.fingerprint,
         profile_json = excluded.profile_json, mapping_json = excluded.mapping_json`, runId,
      file.slotKey,
      file.fileName,
      file.storedPath,
      file.profile.fingerprint,
      JSON.stringify(file.profile),
      JSON.stringify(file.mapping),));
}

export async function updateRunFileMapping(runId: string, slotKey: string, mapping: SlotMapping) {
  await getDb().run("UPDATE run_files SET mapping_json = ? WHERE run_id = ? AND slot_key = ?", JSON.stringify(mapping), runId, slotKey);
}

export async function getRunFiles(runId: string): Promise<RunFile[]> {
  const rows = (await getDb().all("SELECT * FROM run_files WHERE run_id = ?", runId)) as Row[];
  return rows.map((r) => ({
    slotKey: String(r.slot_key),
    fileName: String(r.file_name),
    storedPath: String(r.stored_path),
    profile: JSON.parse(String(r.profile_json)),
    mapping: JSON.parse(String(r.mapping_json)),
  }));
}

export async function addQuestion(runId: string, slotKey: string | null, payload: QuestionPayload): Promise<Question> {
  const db = getDb();
  const seq = (((await db.get("SELECT COALESCE(MAX(seq), 0) AS m FROM questions WHERE run_id = ?", runId)) as Row).m as number) + 1;
  const q: Question = { id: randomUUID(), seq, slotKey, payload, answer: null };
  (await db.run("INSERT INTO questions (id, run_id, seq, slot_key, kind, payload_json) VALUES (?, ?, ?, ?, ?, ?)", q.id,
    runId,
    seq,
    slotKey,
    payload.kind,
    JSON.stringify(payload),));
  return q;
}

export async function deleteQuestion(id: string) {
  await getDb().run("DELETE FROM questions WHERE id = ? AND answer_json IS NULL", id);
}

/** Drops unanswered questions for a slot, e.g. when the user replaces its file. */
export async function deleteOpenQuestions(runId: string, slotKey: string) {
  await getDb().run("DELETE FROM questions WHERE run_id = ? AND slot_key = ? AND answer_json IS NULL", runId, slotKey);
}

export async function getQuestions(runId: string): Promise<Question[]> {
  const rows = (await getDb().all("SELECT * FROM questions WHERE run_id = ? ORDER BY seq", runId)) as Row[];
  return rows.map((r) => ({
    id: String(r.id),
    seq: Number(r.seq),
    slotKey: r.slot_key === null ? null : String(r.slot_key),
    payload: JSON.parse(String(r.payload_json)),
    answer: r.answer_json === null ? null : JSON.parse(String(r.answer_json)),
  }));
}

export async function setAnswer(questionId: string, answer: string) {
  await getDb().run("UPDATE questions SET answer_json = ? WHERE id = ?", JSON.stringify(answer), questionId);
}

export async function addMessage(runId: string, role: Message["role"], body: string, questionId: string | null = null, payload?: ChatPayload) {
  await getDb().run("INSERT INTO messages (run_id, role, body, question_id, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)", runId, role, body, questionId, now(), payload ? JSON.stringify(payload) : null);
}

export async function getMessages(runId: string): Promise<Message[]> {
  const rows = (await getDb().all("SELECT * FROM messages WHERE run_id = ? ORDER BY id", runId)) as Row[];
  return rows.map((r) => ({
    id: Number(r.id),
    role: r.role as Message["role"],
    body: String(r.body),
    questionId: r.question_id === null ? null : String(r.question_id),
    ...(r.payload_json ? { payload: JSON.parse(String(r.payload_json)) as ChatPayload } : {}),
  }));
}

export async function getCachedMapping(orgKey: string, templateId: string, slotKey: string, fingerprint: string): Promise<SlotMapping | undefined> {
  const r = (await getDb().get("SELECT mapping_json FROM mapping_cache WHERE org_key = ? AND template_id = ? AND slot_key = ? AND fingerprint = ?", orgKey, templateId, slotKey, fingerprint)) as Row | undefined;
  return r ? JSON.parse(String(r.mapping_json)) : undefined;
}

export async function saveCachedMapping(orgKey: string, templateId: string, slotKey: string, fingerprint: string, mapping: SlotMapping) {
  (await getDb().run(`INSERT INTO mapping_cache (org_key, template_id, slot_key, fingerprint, mapping_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (org_key, template_id, slot_key, fingerprint) DO UPDATE SET mapping_json = excluded.mapping_json, updated_at = excluded.updated_at`, orgKey, templateId, slotKey, fingerprint, JSON.stringify(mapping), now()));
}

/** PDF layout recipes per workspace, newest first: a repeat statement from the same issuer reuses its recipe. */
export async function getPdfLayouts(orgKey: string, issuerKey: string): Promise<LayoutRecipe[]> {
  const rows = (await getDb().all("SELECT recipe_json FROM pdf_layouts WHERE org_key = ? AND issuer_key = ? ORDER BY updated_at DESC LIMIT 5", orgKey, issuerKey)) as Row[];
  return rows.map((r) => JSON.parse(String(r.recipe_json)));
}

export async function savePdfLayout(orgKey: string, recipe: LayoutRecipe) {
  (await getDb().run(`INSERT INTO pdf_layouts (org_key, fingerprint, issuer_key, recipe_json, uses, updated_at) VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT (org_key, fingerprint) DO UPDATE SET recipe_json = excluded.recipe_json, uses = pdf_layouts.uses + 1, updated_at = excluded.updated_at`, orgKey, recipe.fingerprint, recipe.issuerKey, JSON.stringify(recipe), now()));
}

/** How a slot's PDF(s) were read: metadata and pre-match checks. Kept with the run's other checks. */
export async function setPdfInfo(runId: string, slotKey: string, info: PdfFileInfo[] | null) {
  await setRunCheck(runId, `pdf_${slotKey}`, info);
}

export async function getPdfInfo(runId: string, slotKey: string): Promise<PdfFileInfo[] | undefined> {
  return (await getRunCheck<PdfFileInfo[] | null>(runId, `pdf_${slotKey}`)) ?? undefined;
}

export async function getRule<T>(orgKey: string, templateId: string, ruleKey: string): Promise<T | undefined> {
  const r = (await getDb().get("SELECT value_json FROM template_rules WHERE org_key = ? AND template_id = ? AND rule_key = ?", orgKey, templateId, ruleKey)) as Row | undefined;
  return r ? (JSON.parse(String(r.value_json)) as T) : undefined;
}

export async function setRule(orgKey: string, templateId: string, ruleKey: string, value: unknown) {
  (await getDb().run(`INSERT INTO template_rules (org_key, template_id, rule_key, value_json) VALUES (?, ?, ?, ?)
       ON CONFLICT (org_key, template_id, rule_key) DO UPDATE SET value_json = excluded.value_json`, orgKey, templateId, ruleKey, JSON.stringify(value)));
}

export async function saveResult(runId: string, result: ReconResult) {
  (await getDb().run(`INSERT INTO run_results (run_id, result_json, created_at) VALUES (?, ?, ?)
       ON CONFLICT (run_id) DO UPDATE SET result_json = excluded.result_json, created_at = excluded.created_at`, runId, JSON.stringify(result), now()));
}

export async function getResult(runId: string): Promise<(ReconResult & { createdAt: string }) | undefined> {
  const r = (await getDb().get("SELECT result_json, created_at FROM run_results WHERE run_id = ?", runId)) as Row | undefined;
  return r ? { ...JSON.parse(String(r.result_json)), createdAt: String(r.created_at) } : undefined;
}

/** Results go stale the moment a file, mapping or answer changes. */
export async function clearResult(runId: string) {
  await getDb().run("DELETE FROM run_results WHERE run_id = ?", runId);
  await getDb().run("DELETE FROM run_narratives WHERE run_id = ?", runId);
}

// ─── Narrative cache: one per result, so re-opening a run never spends tokens ─────

export async function getNarrative<T>(runId: string, resultAt: string): Promise<{ source: string; body: T } | undefined> {
  const r = (await getDb().get("SELECT source, body_json FROM run_narratives WHERE run_id = ? AND result_at = ?", runId, resultAt)) as Row | undefined;
  return r ? { source: String(r.source), body: JSON.parse(String(r.body_json)) as T } : undefined;
}

export async function saveNarrative(runId: string, resultAt: string, source: string, body: unknown) {
  (await getDb().run(`INSERT INTO run_narratives (run_id, result_at, source, body_json, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (run_id) DO UPDATE SET result_at = excluded.result_at, source = excluded.source, body_json = excluded.body_json, created_at = excluded.created_at`, runId, resultAt, source, JSON.stringify(body), now()));
}

// ─── Workspace templates (saved from a generic two-file reconciliation) ───────────

export async function saveCustomTemplate(orgKey: string, template: Template) {
  await getDb().run("INSERT INTO custom_templates (id, org_key, template_json, created_at) VALUES (?, ?, ?, ?)", template.id, orgKey, JSON.stringify(template), now());
}

export async function getCustomTemplate(orgKey: string, id: string): Promise<Template | undefined> {
  const r = (await getDb().get("SELECT template_json FROM custom_templates WHERE id = ? AND org_key = ?", id, orgKey)) as Row | undefined;
  return r ? (JSON.parse(String(r.template_json)) as Template) : undefined;
}

export async function listCustomTemplates(orgKey: string): Promise<Template[]> {
  const rows = (await getDb().all("SELECT template_json FROM custom_templates WHERE org_key = ? ORDER BY created_at DESC", orgKey)) as Row[];
  return rows.map((r) => JSON.parse(String(r.template_json)) as Template);
}

export async function deleteCustomTemplate(orgKey: string, id: string) {
  await getDb().run("DELETE FROM custom_templates WHERE id = ? AND org_key = ?", id, orgKey);
}

export async function getRunCheck<T>(runId: string, checkKey: string): Promise<T | undefined> {
  const r = (await getDb().get("SELECT value_json FROM run_checks WHERE run_id = ? AND check_key = ?", runId, checkKey)) as Row | undefined;
  return r ? (JSON.parse(String(r.value_json)) as T) : undefined;
}

export async function setRunCheck(runId: string, checkKey: string, value: unknown) {
  (await getDb().run(`INSERT INTO run_checks (run_id, check_key, value_json) VALUES (?, ?, ?)
       ON CONFLICT (run_id, check_key) DO UPDATE SET value_json = excluded.value_json`, runId, checkKey, JSON.stringify(value)));
}

export async function logUsage(runId: string | null, purpose: string, usage: LlmUsage) {
  (await getDb().run(`INSERT INTO llm_usage (run_id, purpose, model, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, runId, purpose, usage.model, usage.inputTokens, usage.cacheReadTokens, usage.cacheWriteTokens, usage.outputTokens, now()));
}

export type UsageSummary = { calls: number; inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number };

export async function getUsage(runId: string): Promise<UsageSummary> {
  const r = (await getDb().get(`SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(cache_read_tokens),0) AS cr,
              COALESCE(SUM(cache_write_tokens),0) AS cw, COALESCE(SUM(output_tokens),0) AS o
       FROM llm_usage WHERE run_id = ?`, runId)) as Row;
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
export async function listRuns(orgKey: string): Promise<RunSummary[]> {
  const rows = (await getDb().all(`SELECT r.id, r.org_key, r.template_id, r.status, r.created_at,
              (SELECT COUNT(*) FROM run_files f WHERE f.run_id = r.id) AS files,
              rr.created_at AS ran_at,
              (rr.result_json::jsonb #>> '{totals,exceptions}')::float8 AS exceptions,
              (rr.result_json::jsonb #>> '{totals,value}')::float8 AS value,
              rr.result_json::jsonb #>> '{currency}' AS currency
       FROM runs r LEFT JOIN run_results rr ON rr.run_id = r.id
       WHERE r.org_key = ? ORDER BY r.created_at DESC`, orgKey)) as Row[];
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
export async function listUsageRecords(orgKey: string | null, since?: string): Promise<UsageRecord[]> {
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
  const rows = (await getDb().all(`SELECT u.run_id, r.org_key, ${orgKey !== null ? "NULL" : "o.name"} AS org_name, r.template_id, r.created_at AS run_started_at,
              u.purpose, u.model, u.input_tokens, u.cache_read_tokens, u.cache_write_tokens, u.output_tokens, u.created_at
       FROM llm_usage u
       ${orgKey !== null ? "JOIN" : "LEFT JOIN"} runs r ON r.id = u.run_id
       ${orgKey !== null ? "" : "LEFT JOIN orgs o ON o.key = r.org_key"}
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY u.created_at, u.id`, ...args)) as Row[];
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
export async function listRunActivity(orgKey: string | null): Promise<RunActivityRecord[]> {
  const rows = (await getDb().all(`SELECT r.id, r.org_key, r.template_id, r.created_at,
              (SELECT COUNT(*) FROM questions q WHERE q.run_id = r.id) AS questions,
              (SELECT COUNT(*) FROM llm_usage u WHERE u.run_id = r.id AND u.purpose = 'column_mapping') AS mapping_calls,
              EXISTS (SELECT 1 FROM run_results rr WHERE rr.run_id = r.id) AS has_result
       FROM runs r ${orgKey !== null ? "WHERE r.org_key = ?" : ""}`, ...(orgKey !== null ? [orgKey] : []))) as Row[];
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
