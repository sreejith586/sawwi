import { getTemplate } from "@/lib/templates/catalog";
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

export type RunView = {
  id: string;
  templateId: string;
  templateTitle: string;
  status: RunStatus;
  slots: SlotView[];
  messages: Message[];
  openQuestions: ({ id: string } & QuestionView)[];
  usage: store.UsageSummary;
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
  };
}
