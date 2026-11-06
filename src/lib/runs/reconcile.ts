import type { Country } from "@/lib/profile/options";
import { loadDataset, type Dataset } from "@/lib/recon/load";
import { reconcile, type ReconResult } from "@/lib/recon/match";
import { getTemplate } from "@/lib/templates/catalog";
import type { KeyNormalizer } from "@/lib/templates/types";
import { COUNTRY_CURRENCY, computeStatus, getKeyRule, RunInputError } from "./engine";
import * as store from "./store";
import type { Run } from "./types";

export function loadRunDatasets(run: Run): Map<string, Dataset> {
  const template = getTemplate(run.templateId)!;
  const datasets = new Map<string, Dataset>();
  for (const file of store.getRunFiles(run.id)) {
    const slot = template.sources.find((s) => s.key === file.slotKey);
    if (slot) datasets.set(slot.key, loadDataset(file, slot));
  }
  return datasets;
}

export function runReconciliation(run: Run, countries: Country[]): ReconResult {
  const template = getTemplate(run.templateId);
  if (!template) throw new RunInputError("This run's template no longer exists.");
  const status = computeStatus(template, store.getRunFiles(run.id), store.getQuestions(run.id));
  if (status !== "ready" && status !== "done") throw new RunInputError("Upload every file and answer the open questions first.");

  // Key formats the user approved ("ignore symbols and leading zeros"), saved per company.
  const extraNormalizers = new Map<string, KeyNormalizer[]>();
  template.links.forEach((link, li) =>
    link.keys.forEach((_, ki) => {
      const extra = getKeyRule(run.orgKey, run.templateId, li, ki);
      if (extra?.length) extraNormalizers.set(`${li}:${ki}`, extra);
    }),
  );

  const result = reconcile({ template, datasets: loadRunDatasets(run), extraNormalizers });
  if (!result.currency && countries[0]) result.currency = COUNTRY_CURRENCY[countries[0]];

  store.saveResult(run.id, result);
  store.setRunStatus(run.id, "done");
  run.status = "done";
  store.addMessage(run.id, "sawwi", summarize(result, template.sources.find((s) => s.key === template.links[0].left)?.label ?? "rows"));
  return result;
}

export function formatMoney(value: number, currency?: string) {
  const n = value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${n}` : n;
}

/** Plain-language summary written by code, not the LLM: free, instant and always accurate. */
function summarize(r: ReconResult, leftLabel: string): string {
  const main = r.links[0];
  const rate = main.leftRows ? Math.round((main.matchedLeft / main.leftRows) * 1000) / 10 : 0;
  let text = `Done. Matched ${main.matchedLeft.toLocaleString()} of ${main.leftRows.toLocaleString()} rows in your ${leftLabel.toLowerCase()} (${rate}%).`;
  const found = r.checks.filter((c) => c.status === "done" && c.count > 0).sort((a, b) => b.value - a.value || b.count - a.count);
  if (found.length === 0) return `${text} No exceptions found. Everything reconciles.`;
  text += ` I found ${r.totals.exceptions.toLocaleString()} exceptions worth ${formatMoney(r.totals.value, r.currency)}.`;
  text += " Biggest: " + found.slice(0, 3).map((c) => `${c.label.toLowerCase()} (${c.count}${c.value ? `, ${formatMoney(c.value, r.currency)}` : ""})`).join("; ") + ".";
  return text;
}
