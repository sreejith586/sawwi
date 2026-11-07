"use server";

import { redirect } from "next/navigation";
import { chat as runChat, ChatInputError, narrativeFor, type ChatIntent, type NarrativeView } from "@/lib/insights/chat";
import { getProfile } from "@/lib/profile/session";
import { getOwnedRun, orgKeyFor } from "@/lib/runs/access";
import * as store from "@/lib/runs/store";
import { GENERIC_SETUP_KEY, saveRunAsTemplate } from "@/lib/runs/templates";
import { buildRunView } from "@/lib/runs/view";
import { runBlocker } from "@/lib/saas/session";
import { cleanLabel, DEFAULT_SETUP, GENERIC_TEMPLATE_ID, isCustomId, parseTolerance } from "@/lib/templates/custom";
import type { RunActionResult } from "./runs";

/** The analysis above the report: cached per result. Read-only users get the free summary. */
export async function getNarrative(runId: string): Promise<NarrativeView | undefined> {
  const owned = await getOwnedRun(runId);
  if (!owned) return undefined;
  const blocked = await runBlocker();
  return narrativeFor(owned.run, !blocked);
}

/** One follow-up chat turn: a one-click action or a free-text question. */
export async function sendChat(runId: string, intent: ChatIntent): Promise<RunActionResult> {
  const owned = await getOwnedRun(runId);
  if (!owned) return { error: "Run not found." };
  // Chat can spend AI tokens, so it follows the same plan and role gate as running a reco.
  const blocked = await runBlocker();
  if (blocked) return { error: blocked.message, view: await buildRunView(runId) };
  try {
    await runChat(owned.run, intent, owned.profile.company);
  } catch (error) {
    if (error instanceof ChatInputError) return { error: error.message, view: await buildRunView(runId) };
    throw error;
  }
  return { view: await buildRunView(runId) };
}

// ─── No template fits ───────────────────────────────────────────────────────

export async function startGenericRun(formData: FormData) {
  const profile = await getProfile();
  if (!profile) redirect("/onboarding");
  const blocked = await runBlocker();
  if (blocked) redirect(`/settings/billing?blocked=${blocked.reason}`);
  const run = await store.createRun(orgKeyFor(profile), GENERIC_TEMPLATE_ID);
  await store.setRunCheck(run.id, GENERIC_SETUP_KEY, {
    leftLabel: cleanLabel(formData.get("left")?.toString(), DEFAULT_SETUP.leftLabel),
    rightLabel: cleanLabel(formData.get("right")?.toString(), DEFAULT_SETUP.rightLabel),
    tolerance: parseTolerance(formData.get("tolerance")?.toString()),
  });
  await store.addMessage(
    run.id,
    "sawwi",
    "A custom reconciliation: upload the two files and I'll ask which column is the matching key and which is the amount in each. Once it works, you can save it as a template.",
  );
  redirect(`/runs/${run.id}`);
}

/** Saves a generic run's setup, and its confirmed column mappings, as a workspace template. */
export async function saveAsTemplate(runId: string, title: string): Promise<RunActionResult & { templateId?: string }> {
  const owned = await getOwnedRun(runId);
  if (!owned) return { error: "Run not found." };
  const blocked = await runBlocker();
  if (blocked) return { error: blocked.message, view: await buildRunView(runId) };
  const { run } = owned;
  if (run.templateId !== GENERIC_TEMPLATE_ID) return { error: "Only custom reconciliations can be saved as templates.", view: await buildRunView(runId) };
  if (run.status !== "ready" && run.status !== "done") {
    return { error: "Upload both files and answer the questions first, so the template knows your columns.", view: await buildRunView(runId) };
  }

  const template = await saveRunAsTemplate(run, title);
  await store.addMessage(run.id, "sawwi", `Saved as "${template.title}". It's under Your templates in the gallery; next time, start it from there and I'll remember these columns.`);
  return { view: await buildRunView(runId), templateId: template.id };
}

export async function deleteTemplate(templateId: string) {
  const profile = await getProfile();
  if (!profile || !isCustomId(templateId)) return;
  const blocked = await runBlocker();
  if (blocked) return;
  await store.deleteCustomTemplate(orgKeyFor(profile), templateId);
  redirect("/templates");
}

