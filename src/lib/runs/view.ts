import { severityOf, type Severity } from "@/lib/recon/severity";
import type { ReconResult } from "@/lib/recon/match";
import { getTemplate } from "@/lib/templates/catalog";
import type { Template } from "@/lib/templates/types";
import { presentQuestion, type QuestionView } from "./engine";
import * as store from "./store";
import type { MappingSource, Message, RunStatus } from "./types";

// Serializable snapshot of a run for the client workspace.

export type FieldRow = {
  key: string;
  label: string;
  required: boolean;
  column: string | null;
  source: MappingSource | null;
};

export type SlotView = {
  key: string;
  label: string;
  description: string;
  examples: string[];
  optional: boolean;
  file?: {
    name: string;
    rowCount: number;
    columns: string[];
    fields: FieldRow[];
    remembered: boolean;
  };
};

export type ReportCheck = ReconResult["checks"][number] & { severity: Severity };

export type ReportException = {
  id: number;
  check: string;
  checkLabel: string;
  severity: Severity;
  key: string;
  leftFile?: string;
  leftRows?: string;
  rightFile?: string;
  rightRows?: string;
  leftValue?: number;
  rightValue?: number;
  diff?: number;
  value: number;
  note?: string;
};

export type ReportView = {
  ranAt: string;
  asOf: string;
  currency?: string;
  links: (ReconResult["links"][number] & { leftLabel: string; rightLabel: string })[];
  checks: ReportCheck[];
  exceptions: ReportException[];
  /** True when there are more exceptions than the page shows (the Excel export has them all). */
  truncated: boolean;
  totals: ReconResult["totals"];
};

/** Exceptions shipped to the browser; Excel exports include every stored exception. */
const UI_EXCEPTION_LIMIT = 1500;

export function buildReport(template: Template, result: ReconResult & { createdAt: string }, limit = UI_EXCEPTION_LIMIT): ReportView {
  const slotLabel = (key: string) => template.sources.find((s) => s.key === key)?.label ?? key;
  const checkMeta = new Map(template.checks.map((c) => [c.id, { label: c.label, severity: severityOf(c.rule) }]));
  const rows = (r?: { rows: number[] }) => (r ? (r.rows.length > 3 ? `${r.rows.slice(0, 3).join(", ")} +${r.rows.length - 3}` : r.rows.join(", ")) : undefined);
  return {
    ranAt: result.createdAt,
    asOf: result.asOf,
    currency: result.currency,
    links: result.links.map((l) => ({ ...l, leftLabel: slotLabel(l.left), rightLabel: slotLabel(l.right) })),
    checks: result.checks.map((c) => ({ ...c, severity: checkMeta.get(c.id)?.severity ?? "high" })),
    exceptions: result.exceptions.slice(0, limit).map((e, id) => ({
      id,
      check: e.check,
      checkLabel: checkMeta.get(e.check)?.label ?? e.check,
      severity: checkMeta.get(e.check)?.severity ?? "high",
      key: e.key,
      leftFile: e.left && slotLabel(e.left.slot),
      leftRows: rows(e.left),
      rightFile: e.right && slotLabel(e.right.slot),
      rightRows: rows(e.right),
      leftValue: e.leftValue,
      rightValue: e.rightValue,
      diff: e.diff,
      value: Math.round(Math.abs(e.value) * 100) / 100,
      note: e.note,
    })),
    truncated: result.exceptions.length > limit,
    totals: result.totals,
  };
}

export type RunView = {
  id: string;
  templateId: string;
  templateTitle: string;
  status: RunStatus;
  slots: SlotView[];
  messages: Message[];
  openQuestions: ({ id: string } & QuestionView)[];
  usage: store.UsageSummary;
  report?: ReportView;
};

export function buildRunView(runId: string): RunView | undefined {
  const run = store.getRun(runId);
  const template = run && getTemplate(run.templateId);
  if (!run || !template) return undefined;

  const files = store.getRunFiles(run.id);
  const questions = store.getQuestions(run.id);

  return {
    id: run.id,
    templateId: template.id,
    templateTitle: template.title,
    status: run.status,
    slots: template.sources.map((slot) => {
      const file = files.find((f) => f.slotKey === slot.key);
      return {
        key: slot.key,
        label: slot.label,
        description: slot.description,
        examples: slot.examples,
        optional: Boolean(slot.optional),
        ...(file && {
          file: {
            name: file.fileName,
            rowCount: file.profile.rowCount,
            columns: file.profile.columns.map((c) => c.name),
            remembered: Object.values(file.mapping.fields).every((f) => f.source === "remembered"),
            fields: slot.fields.map((f) => ({
              key: f.key,
              label: f.label,
              required: Boolean(f.required),
              column: file.mapping.fields[f.key]?.column ?? null,
              source: file.mapping.fields[f.key]?.source ?? null,
            })),
          },
        }),
      };
    }),
    messages: store.getMessages(run.id),
    openQuestions: questions
      .filter((q) => q.answer === null)
      .map((q) => ({ id: q.id, ...presentQuestion(q.payload, template, q.slotKey) })),
    usage: store.getUsage(run.id),
    report: (() => {
      const result = store.getResult(run.id);
      return result ? buildReport(template, result) : undefined;
    })(),
  };
}
