import { getTemplate } from "@/lib/templates/catalog";
import { customTemplateFrom, DEFAULT_SETUP, GENERIC_TEMPLATE_ID, genericTemplate, isCustomId, type GenericSetup } from "@/lib/templates/custom";
import type { Template } from "@/lib/templates/types";
import * as store from "./store";
import type { Run } from "./types";

// One lookup for every kind of template a run can use: the seeded catalogue, the generic
// two-file reco (configured per run) and templates a workspace saved for itself.

export const GENERIC_SETUP_KEY = "generic_setup";

export async function genericSetupFor(runId: string): Promise<GenericSetup> {
  return { ...DEFAULT_SETUP, ...(await store.getRunCheck<GenericSetup>(runId, GENERIC_SETUP_KEY)) };
}

export async function templateFor(orgKey: string, templateId: string, runId?: string): Promise<Template | undefined> {
  if (templateId === GENERIC_TEMPLATE_ID) return genericTemplate(runId ? await genericSetupFor(runId) : DEFAULT_SETUP);
  if (isCustomId(templateId)) return await store.getCustomTemplate(orgKey, templateId);
  return getTemplate(templateId);
}

export async function templateForRun(run: Run): Promise<Template | undefined> {
  return await templateFor(run.orgKey, run.templateId, run.id);
}

/** Saves a generic run's setup, and its confirmed column mappings, as a workspace template. */
export async function saveRunAsTemplate(run: Run, title: string): Promise<Template> {
  const template = customTemplateFrom(await genericSetupFor(run.id), title);
  await store.saveCustomTemplate(run.orgKey, template);
  // Carry the confirmed mappings over, so the next run with the same exports asks nothing.
  for (const file of await store.getRunFiles(run.id)) {
    await store.saveCachedMapping(run.orgKey, template.id, file.slotKey, file.profile.fingerprint, file.mapping);
  }
  return template;
}
