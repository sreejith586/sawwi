import { RUN_STATUS } from "@/lib/runs/status";
import type { RunSummary } from "@/lib/runs/store";
import { getTemplate } from "@/lib/templates/catalog";
import { GROUP_LABELS } from "@/lib/templates/types";

// Server-side: shared by the Reconciliations page and its Excel export (same rows, same filters).

export type RunRow = {
  id: string;
  template: string;
  group: string;
  status: string;
  statusKey: string;
  started: string;
  startedLabel: string;
  files: number;
  exceptions: number | "";
  value: number | "";
  currency: string;
};

const dateLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export function runRows(runs: RunSummary[]): RunRow[] {
  return runs.map((r) => {
    const t = getTemplate(r.templateId);
    return {
      id: r.id,
      template: t?.title ?? r.templateId,
      group: t ? GROUP_LABELS[t.group] : "",
      status: RUN_STATUS[r.status].label,
      statusKey: r.status,
      started: r.createdAt,
      startedLabel: dateLabel(r.createdAt),
      files: r.files,
      exceptions: r.exceptions ?? "",
      value: r.value ?? "",
      currency: r.currency ?? "",
    };
  });
}

