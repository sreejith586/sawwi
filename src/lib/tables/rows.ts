import type { MappingSource } from "@/lib/runs/types";
import type { SlotView } from "@/lib/runs/view";
import type { Template } from "@/lib/templates/types";

// Row builders shared by the screen and the Excel export, so a download always
// matches what the table shows (same fields, same filters, same sort keys).

export const MAPPING_SOURCE_LABELS: Record<MappingSource, string> = {
  remembered: "Remembered",
  auto: "Auto-matched",
  ai: "AI-matched",
  user: "Set by you",
};

export type MappingStatus = "Mapped" | "Missing" | "Not in file";

export type MappingRow = {
  id: string;
  field: string;
  required: "Required" | "Optional";
  column: string;
  status: MappingStatus;
  source: string;
};

export function mappingRows(slot: SlotView): MappingRow[] {
  return (slot.file?.fields ?? []).map((f) => ({
    id: f.key,
    field: f.label,
    required: f.required ? "Required" : "Optional",
    column: f.column ?? "",
    status: f.column ? "Mapped" : f.required ? "Missing" : "Not in file",
    source: f.column && f.source ? MAPPING_SOURCE_LABELS[f.source] : "",
  }));
}

export const MAPPING_SEARCH = ["field", "column"] as const;
export const MAPPING_FILTERS = ["status", "source", "required"];

const TYPE_LABELS: Record<string, string> = { id: "Identifier", text: "Text", date: "Date", money: "Amount", number: "Number", percent: "Percent" };

export type SpecRow = { id: string; file: string; field: string; type: string; required: "Required" | "Optional"; examples: string };

export function specRows(template: Template): SpecRow[] {
  return template.sources.flatMap((s) =>
    s.fields.map((f) => ({
      id: `${s.key}.${f.key}`,
      file: s.label,
      field: f.label,
      type: TYPE_LABELS[f.type] ?? f.type,
      required: f.required ? "Required" : "Optional",
      examples: s.examples.join("; "),
    })),
  );
}

export const SPEC_SEARCH = ["file", "field"] as const;
export const SPEC_FILTERS = ["file", "type", "required"];

/** Uploaded file rows keyed c0…cN so the shared query helper can filter and sort them. */
export type PreviewRow = Record<string, string | number> & { id: string };

export function previewFilterKeys(headers: string[]): string[] {
  return headers.map((_, i) => `c${i}`);
}
