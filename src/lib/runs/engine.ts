import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { dataDir } from "@/lib/db";
import { parseUploads } from "@/lib/files/parse";
import { profileTable, type FileProfile } from "@/lib/files/profile";
import { assign, AUTO_ACCEPT, CONFIRM_FLOOR, scoreCandidates } from "@/lib/mapping/heuristic";
import { checkKeyOverlap, containmentOverlap } from "@/lib/mapping/keycheck";
import { llmAvailable, suggestMappings } from "@/lib/mapping/llm";
import type { PdfFileInfo } from "@/lib/pdf/types";
import type { Country } from "@/lib/profile/options";
import { getTemplate } from "@/lib/templates/catalog";
import type { CanonicalField, KeyNormalizer, SourceSlot, Template } from "@/lib/templates/types";
import * as store from "./store";
import { NONE_OPTION, type FieldMapping, type QuestionPayload, type Run, type RunFile, type RunStatus, type SlotMapping } from "./types";

export const COUNTRY_CURRENCY: Record<Country, string> = { AE: "AED", SA: "SAR", KW: "KWD", QA: "QAR", BH: "BHD", OM: "OMR" };

export type RunContext = { countries: Country[] };

export class RunInputError extends Error {}

function requireTemplate(run: Run): Template {
  const t = getTemplate(run.templateId);
  if (!t) throw new RunInputError("This run's template no longer exists.");
  return t;
}

function requireSlot(template: Template, slotKey: string): SourceSlot {
  const s = template.sources.find((x) => x.key === slotKey);
  if (!s) throw new RunInputError("Unknown file slot.");
  return s;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ─── Mapping ──────────────────────────────────────────────────────────────

type MappingResult = { mapping: SlotMapping; questions: QuestionPayload[]; usedAi: boolean; remembered: boolean };

async function buildMapping(run: Run, slot: SourceSlot, profile: FileProfile, ctx: RunContext): Promise<MappingResult> {
  const cached = store.getCachedMapping(run.orgKey, run.templateId, slot.key, profile.fingerprint);
  if (cached) {
    const fields = Object.fromEntries(
      Object.entries(cached.fields).map(([k, v]) => [k, { ...v, source: "remembered" as const }]),
    );
    return { mapping: { ...cached, fields }, questions: [], usedAi: false, remembered: true };
  }

  const fields: Record<string, FieldMapping> = {};
  const confirm: { field: string; column: string }[] = [];
  const candidates = scoreCandidates(slot.fields, profile.columns);
  const best = assign(candidates);

  for (const field of slot.fields) {
    const c = best.get(field.key);
    if (c && c.score >= AUTO_ACCEPT) fields[field.key] = { column: c.column, source: "auto", confidence: c.score };
    else if (c && c.score >= CONFIRM_FLOOR && field.required) confirm.push({ field: field.key, column: c.column });
    else if (c && c.score >= 0.7) fields[field.key] = { column: c.column, source: "auto", confidence: c.score };
  }

  // Only the fields heuristics couldn't place go to the LLM.
  let usedAi = false;
  const pending = new Set(confirm.map((c) => c.field));
  const unresolved = slot.fields.filter((f) => !fields[f.key] && !pending.has(f.key));
  if (unresolved.length > 0 && llmAvailable()) {
    const taken = new Set([...Object.values(fields).map((f) => f.column), ...confirm.map((c) => c.column)]);
    const available = profile.columns.filter((c) => !taken.has(c.name));
    try {
      const { suggestions, usage } = await suggestMappings({ sourceLabel: slot.label, fields: unresolved, columns: available });
      store.logUsage(run.id, "column_mapping", usage);
      usedAi = true;
      const usedByAi = new Set<string>();
      for (const s of suggestions) {
        if (!s.column || usedByAi.has(s.column)) continue;
        const field = slot.fields.find((f) => f.key === s.field)!;
        if (s.confidence >= AUTO_ACCEPT) fields[s.field] = { column: s.column, source: "ai", confidence: s.confidence };
        else if (s.confidence >= CONFIRM_FLOOR && field.required) confirm.push({ field: s.field, column: s.column });
        else continue;
        usedByAi.add(s.column);
      }
    } catch (error) {
      // Mapping still works without the LLM; required gaps become questions below.
      console.error("LLM column mapping failed", error);
    }
  }

  const questions: QuestionPayload[] = confirm.map((c) => ({ kind: "confirm_column", ...c }));
  const asked = new Set(confirm.map((c) => c.field));
  for (const field of slot.fields) {
    if (fields[field.key] || asked.has(field.key)) continue;
    if (field.required) questions.push({ kind: "choose_column", field: field.key, options: columnOptions(field, profile, fields) });
    else fields[field.key] = { column: null, source: "auto", confidence: 0 };
  }

  const mapping: SlotMapping = { fields, dateFormats: {} };
  questions.push(...formatQuestions(slot, profile, mapping, ctx));
  return { mapping, questions, usedAi, remembered: false };
}

/** Up to six columns whose data could hold this field, best name matches first. */
function columnOptions(field: CanonicalField, profile: FileProfile, mapped: Record<string, FieldMapping>, exclude: string[] = []): string[] {
  const taken = new Set([...Object.values(mapped).map((m) => m.column), ...exclude]);
  const ranked = scoreCandidates([field], profile.columns).map((c) => c.column);
  const fitting = profile.columns
    .filter((c) => {
      if (field.type === "money" || field.type === "number" || field.type === "percent") return c.kind === "number";
      if (field.type === "date") return c.kind === "date";
      return c.kind !== "empty";
    })
    .map((c) => c.name);
  return [...new Set([...ranked, ...fitting])].filter((c) => !taken.has(c)).slice(0, 6);
}

/** Questions about how to read values: ambiguous dates, and currency when the file doesn't say. */
function formatQuestions(slot: SourceSlot, profile: FileProfile, mapping: SlotMapping, ctx: RunContext): QuestionPayload[] {
  const out: QuestionPayload[] = [];
  for (const field of slot.fields) {
    if (field.type !== "date") continue;
    const column = mapping.fields[field.key]?.column;
    const col = profile.columns.find((c) => c.name === column);
    if (col?.dateFormat === "AMBIGUOUS" && !mapping.dateFormats[col.name] && !out.some((q) => q.kind === "date_format" && q.column === col.name)) {
      out.push({ kind: "date_format", column: col.name, samples: col.samples.slice(0, 3) });
    }
  }

  const needsCurrency = slot.fields.some((f) => f.type === "money") && slot.fields.some((f) => f.key === "currency");
  const hasCurrencyColumn = Boolean(mapping.fields.currency?.column);
  const hinted = profile.columns.flatMap((c) => c.currencyHints ?? []);
  if (needsCurrency && !hasCurrencyColumn && !mapping.currency) {
    const options = [...new Set(ctx.countries.map((c) => COUNTRY_CURRENCY[c]))];
    if (hinted.length === 1) mapping.currency = hinted[0];
    else if (options.length === 1) mapping.currency = options[0];
    else out.push({ kind: "currency", options });
  }
  return out;
}

// ─── Ingest ───────────────────────────────────────────────────────────────

export async function ingestFile(run: Run, slotKey: string, fileName: string, bytes: Uint8Array, ctx: RunContext) {
  return ingestFiles(run, slotKey, [{ name: fileName, data: bytes }], ctx);
}

/** Slots that hold line-level data (SKU, quantities) read invoice PDFs one row per line, others one row per invoice. */
const LINE_FIELDS = new Set(["sku", "qty", "qty_invoiced", "unit_price", "line_amount"]);

/** One or more files into a slot. Several files (e.g. a month of supplier invoice PDFs) become one table. */
export async function ingestFiles(run: Run, slotKey: string, files: { name: string; data: Uint8Array }[], ctx: RunContext) {
  const template = requireTemplate(run);
  const slot = requireSlot(template, slotKey);
  if (files.length === 0) throw new RunInputError("Choose a file to upload.");

  const table = await parseUploads(files, {
    pdf: {
      grain: slot.fields.some((f) => LINE_FIELDS.has(f.key)) ? "line" : "invoice",
      countries: ctx.countries,
      layouts: { find: (issuer) => store.getPdfLayouts(run.orgKey, issuer), save: (recipe) => store.savePdfLayout(run.orgKey, recipe) },
    },
  });
  if (table.headers.length === 0 || table.rows.length === 0) {
    throw new RunInputError(
      table.pdf
        ? "Sawwi read that PDF but found no rows in it. Check it's the statement or invoice itself, or export the data as CSV/Excel."
        : "That file looks empty. Check it has a header row and at least one data row.",
    );
  }
  const fileName = files.length === 1 ? files[0].name : `${files[0].name} + ${files.length - 1} more`;

  const dir = path.join(dataDir(), "uploads", run.id);
  mkdirSync(dir, { recursive: true });
  const storedPath = path.join(dir, `${slotKey}.csv`);
  writeFileSync(storedPath, Papa.unparse({ fields: table.headers, data: table.rows }));

  const profile = profileTable(table);
  const { mapping, questions, usedAi, remembered } = await buildMapping(run, slot, profile, ctx);

  store.deleteOpenQuestions(run.id, slotKey);
  store.upsertRunFile(run.id, { slotKey, fileName, storedPath, profile, mapping });
  store.setPdfInfo(run.id, slotKey, table.pdf ?? null);

  const mappedCount = Object.values(mapping.fields).filter((f) => f.column).length;
  let summary = `I read ${fileName}: ${plural(profile.rowCount, "row")} and ${plural(profile.columns.length, "column")}. `;
  if (remembered) summary += "I've seen this layout before, so I reused your saved column mapping.";
  else {
    summary += `I matched ${mappedCount} of ${slot.fields.length} fields${usedAi ? " (with a quick AI assist for the unusual ones)" : ""}`;
    summary += questions.length ? ` and have ${plural(questions.length, "quick question")}.` : ".";
  }
  if (table.pdf) summary = `${pdfSummary(table.pdf)} ${summary}`;
  store.addMessage(run.id, "sawwi", summary);
  // Failed balance or VAT checks come first: the rows may be wrong, so nothing runs silently.
  for (const pdf of table.pdf ?? []) {
    const failed = pdf.checks.filter((c) => !c.ok);
    if (failed.length) store.addQuestion(run.id, slotKey, { kind: "pdf_check", fileName: pdf.fileName, detail: failed.map((c) => c.detail).join(" ") });
  }
  for (const q of questions) store.addQuestion(run.id, slotKey, q);

  afterChange(run, template);
}

const KIND_LABEL: Record<PdfFileInfo["kind"], string> = { statement: "statement", invoice: "invoice", table: "table" };
const METHOD_LABEL: Record<PdfFileInfo["method"], string> = {
  zatca_xml: "from its embedded ZATCA e-invoice XML",
  zatca_qr: "from its ZATCA QR code",
  text: "from its text layer",
};

/** One or two sentences on how the PDF(s) were read and whether their checks passed. */
function pdfSummary(infos: PdfFileInfo[]): string {
  if (infos.length === 1) {
    const p = infos[0];
    const meta = Object.fromEntries(p.meta.map((m) => [m.label, m.value]));
    let s = `That's a ${p.pages}-page PDF ${KIND_LABEL[p.kind]}; I read it ${METHOD_LABEL[p.method]}, no AI needed`;
    if (p.layout === "remembered") s += ", using the layout I saved last time";
    s += ".";
    if (meta.Account || meta.IBAN) s += ` Account ${meta.Account ?? meta.IBAN}${meta.Period ? `, ${meta.Period}` : ""}.`;
    if (p.skipped) s += ` I set aside ${plural(p.skipped, "line")} that aren't transactions (opening/closing, carried forward, totals, repeated headers).`;
    const passed = p.checks.filter((c) => c.ok);
    if (p.checks.length && passed.length === p.checks.length) s += ` Checks pass: ${passed.map((c) => c.label.toLowerCase()).join("; ")}.`;
    return s;
  }
  const byMethod = Object.entries(Object.groupBy(infos, (i) => i.method)).map(([m, list]) => `${list!.length} ${METHOD_LABEL[m as PdfFileInfo["method"]]}`);
  const bad = infos.filter((i) => i.checks.some((c) => !c.ok)).length;
  return `I read ${plural(infos.length, "PDF")} (${byMethod.join(", ")}), no AI needed.${bad ? ` ${bad} of them failed a check.` : infos.some((i) => i.checks.length) ? " All their checks pass." : ""}`;
}

// ─── Answers ──────────────────────────────────────────────────────────────

export function answerQuestion(run: Run, questionId: string, answer: string) {
  const template = requireTemplate(run);
  const question = store.getQuestions(run.id).find((q) => q.id === questionId);
  if (!question || question.answer !== null) throw new RunInputError("That question was already answered.");

  const view = presentQuestion(question.payload, template, question.slotKey);
  const option = view.options.find((o) => o.value === answer);
  if (!option) throw new RunInputError("Pick one of the offered answers.");

  const p = question.payload;
  if (p.kind === "pdf_check" && answer === "replace") {
    // Stays open: the slot only clears when the user continues or uploads a new file.
    store.addMessage(run.id, "user", option.label, questionId);
    store.addMessage(run.id, "sawwi", `OK. Drop a corrected ${p.fileName}, or a CSV/Excel export of it, on the same slot to replace it. Until then I'll hold the run.`);
    return;
  }

  store.setAnswer(questionId, answer);
  store.addMessage(run.id, "user", option.label, questionId);

  if (p.kind === "pdf_check") {
    store.addMessage(run.id, "sawwi", "OK, I'll use the rows as read. You can still check them under Preview data.");
  } else if (p.kind === "key_format") {
    store.setRule(run.orgKey, run.templateId, keyRuleName(Math.floor(p.keyIndex / 100), p.keyIndex % 100), answer === "yes" ? p.normalizers : []);
    store.addMessage(
      run.id,
      "sawwi",
      answer === "yes" ? "Done. I'll ignore those differences when matching, now and on future runs." : "OK, I'll match them exactly as written.",
    );
  } else {
    const file = store.getRunFiles(run.id).find((f) => f.slotKey === question.slotKey);
    if (!file) throw new RunInputError("That file was replaced. Answer the newer questions instead.");
    const slot = requireSlot(template, file.slotKey);
    const mapping = file.mapping;

    if (p.kind === "confirm_column") {
      if (answer === "yes") mapping.fields[p.field] = { column: p.column, source: "user", confidence: 1 };
      else {
        const field = slot.fields.find((f) => f.key === p.field)!;
        store.addQuestion(run.id, file.slotKey, {
          kind: "choose_column",
          field: p.field,
          options: columnOptions(field, file.profile, mapping.fields, [p.column]),
        });
      }
    } else if (p.kind === "choose_column") {
      mapping.fields[p.field] = { column: answer === NONE_OPTION ? null : answer, source: "user", confidence: 1 };
      const field = slot.fields.find((f) => f.key === p.field)!;
      if (answer === NONE_OPTION && field.required) {
        store.addMessage(
          run.id,
          "sawwi",
          `I need ${field.label} to run this reconciliation. Upload a version of ${file.fileName} that includes it, or an export with more columns.`,
        );
      } else if (answer !== NONE_OPTION) {
        // A newly mapped date column may need its format confirmed.
        for (const q of formatQuestions(slot, file.profile, mapping, { countries: [] }))
          if (q.kind === "date_format") store.addQuestion(run.id, file.slotKey, q);
      }
    } else if (p.kind === "date_format") {
      mapping.dateFormats[p.column] = answer as "DMY" | "MDY";
    } else if (p.kind === "currency") {
      mapping.currency = answer;
    }

    store.updateRunFileMapping(run.id, file.slotKey, mapping);
  }

  afterChange(run, template);
}

/** Lets the user correct any field from the mapping table. */
export function overrideMapping(run: Run, slotKey: string, fieldKey: string, column: string | null) {
  const template = requireTemplate(run);
  const slot = requireSlot(template, slotKey);
  const file = store.getRunFiles(run.id).find((f) => f.slotKey === slotKey);
  if (!file || !slot.fields.some((f) => f.key === fieldKey)) throw new RunInputError("Unknown field.");
  if (column !== null && !file.profile.columns.some((c) => c.name === column)) throw new RunInputError("Unknown column.");
  for (const [k, v] of Object.entries(file.mapping.fields)) {
    if (k !== fieldKey && column !== null && v.column === column) file.mapping.fields[k] = { column: null, source: "user", confidence: 1 };
  }
  file.mapping.fields[fieldKey] = { column, source: "user", confidence: 1 };
  store.updateRunFileMapping(run.id, slotKey, file.mapping);
  afterChange(run, template);
}

// ─── After every change ───────────────────────────────────────────────────

function afterChange(run: Run, template: Template) {
  store.clearResult(run.id);
  const files = store.getRunFiles(run.id);
  const open = store.getQuestions(run.id).filter((q) => q.answer === null);

  // A slot with no open questions is settled: remember its mapping for next time.
  for (const file of files) {
    if (open.some((q) => q.slotKey === file.slotKey)) continue;
    const wasRemembered = Object.values(file.mapping.fields).every((f) => f.source === "remembered");
    store.saveCachedMapping(run.orgKey, run.templateId, file.slotKey, file.profile.fingerprint, file.mapping);
    if (!wasRemembered && !store.getRunCheck(run.id, `saved_${file.slotKey}_${file.profile.fingerprint}`)) {
      store.setRunCheck(run.id, `saved_${file.slotKey}_${file.profile.fingerprint}`, true);
      if (Object.values(file.mapping.fields).some((f) => f.source === "user")) {
        store.addMessage(run.id, "sawwi", `Got it. I'll remember how to read ${file.fileName}'s layout next time.`);
      }
    }
  }

  runKeyChecks(run, template, files);

  const status = computeStatus(template, store.getRunFiles(run.id), store.getQuestions(run.id));
  if (status !== run.status) {
    store.setRunStatus(run.id, status);
    if (status === "ready" && run.status !== "done") {
      store.addMessage(run.id, "sawwi", "All set. I know how to read every file and how they connect. You can run the reconciliation when you're ready.");
    }
    run.status = status;
  }
}

function readColumn(file: RunFile, column: string): string[] {
  const parsed = Papa.parse<Record<string, string>>(readFileSync(file.storedPath, "utf8"), { header: true, skipEmptyLines: "greedy" });
  return parsed.data.map((r) => r[column] ?? "");
}

function runKeyChecks(run: Run, template: Template, files: RunFile[]) {
  const open = store.getQuestions(run.id).filter((q) => q.answer === null);
  template.links.forEach((link, li) => {
    const left = files.find((f) => f.slotKey === link.left);
    const right = files.find((f) => f.slotKey === link.right);
    if (!left || !right) return;
    if (open.some((q) => q.slotKey === link.left || q.slotKey === link.right)) return;

    link.keys.forEach((key, ki) => {
      if (key.mode === "month") return;
      const lc = left.mapping.fields[key.left]?.column;
      const rc = right.mapping.fields[key.right]?.column;
      if (!lc || !rc) return;
      if (getKeyRule(run.orgKey, run.templateId, li, ki)) return;

      const checkKey = `key_${li}_${ki}`;
      const stamp = `${left.profile.fingerprint}:${left.fileName}|${right.profile.fingerprint}:${right.fileName}|${lc}|${rc}`;
      if (store.getRunCheck<string>(run.id, checkKey) === stamp) return;
      store.setRunCheck(run.id, checkKey, stamp);

      const fieldLabel = requireSlot(template, link.left).fields.find((f) => f.key === key.left)?.label ?? key.left;
      const result =
        key.mode === "contains"
          ? { overlap: containmentOverlap(readColumn(left, lc), readColumn(right, rc), key.normalize ?? []), suggestion: undefined }
          : checkKeyOverlap(readColumn(left, lc), readColumn(right, rc), key.normalize ?? []);
      if (result.suggestion) {
        store.addQuestion(run.id, null, {
          kind: "key_format",
          keyIndex: li * 100 + ki,
          fieldLabel,
          leftExample: result.suggestion.leftExample,
          rightExample: result.suggestion.rightExample,
          normalizers: result.suggestion.normalizers,
        });
      } else if (result.overlap < 0.2 && link.combine !== "or") {
        store.addMessage(
          run.id,
          "sawwi",
          `Heads up: only ${Math.round(result.overlap * 100)}% of ${fieldLabel} values appear in both files. Check that both files cover the same period. I'll still run, but expect many unmatched items.`,
        );
      }
    });
  });
}

/** Saved answer to "match ignoring symbols?" for a link key. Read by the matching engine too. */
export function keyRuleName(linkIndex: number, keyIndex: number) {
  return `key_normalizers_${linkIndex}_${keyIndex}`;
}

/** The saved key-format answer, including ones saved before links existed (`key_normalizers_<n>`). */
export function getKeyRule(orgKey: string, templateId: string, linkIndex: number, keyIndex: number): KeyNormalizer[] | undefined {
  return (
    store.getRule<KeyNormalizer[]>(orgKey, templateId, keyRuleName(linkIndex, keyIndex)) ??
    (linkIndex === 0 ? store.getRule<KeyNormalizer[]>(orgKey, templateId, `key_normalizers_${keyIndex}`) : undefined)
  );
}

export function computeStatus(template: Template, files: RunFile[], questions: { answer: string | null }[]): RunStatus {
  const missingSlot = template.sources.some((s) => !s.optional && !files.some((f) => f.slotKey === s.key));
  if (missingSlot) return "collecting";
  if (questions.some((q) => q.answer === null)) return "clarifying";
  for (const file of files) {
    const slot = template.sources.find((s) => s.key === file.slotKey);
    if (slot?.fields.some((f) => f.required && !file.mapping.fields[f.key]?.column)) return "clarifying";
  }
  return "ready";
}

// ─── Presentation ─────────────────────────────────────────────────────────

export type QuestionView = { prompt: string; options: { value: string; label: string }[] };

export function presentQuestion(p: QuestionPayload, template: Template, slotKey: string | null): QuestionView {
  const slot = slotKey ? template.sources.find((s) => s.key === slotKey) : undefined;
  const label = (field: string) => slot?.fields.find((f) => f.key === field)?.label ?? field;
  const yesNo = [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ];
  switch (p.kind) {
    case "confirm_column":
      return { prompt: `In your ${slot?.label ?? "file"}, is "${p.column}" the ${label(p.field)}?`, options: yesNo };
    case "choose_column":
      return {
        prompt: `Which column in your ${slot?.label ?? "file"} holds the ${label(p.field)}?`,
        options: [...p.options.map((c) => ({ value: c, label: c })), { value: NONE_OPTION, label: "It's not in this file" }],
      };
    case "date_format":
      return {
        prompt: `How should I read dates in "${p.column}" (e.g. ${p.samples.join(", ")})?`,
        options: [
          { value: "DMY", label: "Day first (DD/MM/YYYY)" },
          { value: "MDY", label: "Month first (MM/DD/YYYY)" },
        ],
      };
    case "currency":
      return {
        prompt: `Your ${slot?.label ?? "file"} has no currency column. What currency are its amounts in?`,
        options: p.options.map((c) => ({ value: c, label: c })),
      };
    case "pdf_check":
      return {
        prompt: `${p.fileName} didn't pass a check: ${p.detail} Look at the rows under Preview data. Use them anyway?`,
        options: [
          { value: "continue", label: "Yes, the rows look right" },
          { value: "replace", label: "No, I'll upload a corrected file" },
        ],
      };
    case "key_format":
      return {
        prompt: `${p.fieldLabel} values are written differently in the two files (e.g. "${p.leftExample}" vs "${p.rightExample}"). Match them ignoring symbols and leading zeros?`,
        options: yesNo,
      };
  }
}
