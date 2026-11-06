import type { Country } from "@/lib/profile/options";
import { loadDataset, type Dataset } from "@/lib/recon/load";
import { reconcile, type ReconResult } from "@/lib/recon/match";
import type { KeyNormalizer } from "@/lib/templates/types";
import { slotLabel, summarize } from "@/lib/insights/facts";
import { COUNTRY_CURRENCY, computeStatus, getKeyRule, RunInputError } from "./engine";
import * as store from "./store";
import { templateForRun } from "./templates";
import type { Run } from "./types";

export function loadRunDatasets(run: Run): Map<string, Dataset> {
  const template = templateForRun(run)!;
  const datasets = new Map<string, Dataset>();
  for (const file of store.getRunFiles(run.id)) {
    const slot = template.sources.find((s) => s.key === file.slotKey);
    if (slot) datasets.set(slot.key, loadDataset(file, slot));
  }
  return datasets;
}

export function runReconciliation(run: Run, countries: Country[]): ReconResult {
  const template = templateForRun(run);
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
  store.addMessage(run.id, "sawwi", summarize(result, slotLabel(template, template.links[0].left)));
  return result;
}
