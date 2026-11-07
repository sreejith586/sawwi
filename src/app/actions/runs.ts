"use server";

import { redirect } from "next/navigation";
import { getProfile } from "@/lib/profile/session";
import { runBlocker } from "@/lib/saas/session";
import { getOwnedRun, orgKeyFor } from "@/lib/runs/access";
import { answerQuestion, overrideMapping, RunInputError } from "@/lib/runs/engine";
import { runReconciliation } from "@/lib/runs/reconcile";
import { createRun } from "@/lib/runs/store";
import type { Run } from "@/lib/runs/types";
import type { Country } from "@/lib/profile/options";
import { buildRunView, type RunView } from "@/lib/runs/view";
import { templateFor } from "@/lib/runs/templates";
import { GENERIC_TEMPLATE_ID } from "@/lib/templates/custom";

export type RunActionResult = { view?: RunView; error?: string };

export async function startRun(templateId: string) {
  const profile = await getProfile();
  if (!profile) redirect("/onboarding");
  // Catalogue templates and the workspace's own saved ones; the generic reco has its own setup form.
  if (templateId === GENERIC_TEMPLATE_ID || !await templateFor(orgKeyFor(profile), templateId)) throw new Error("Unknown template");
  // Plan, trial and role gate (a no-op while the paywall is off, except for viewers).
  const blocked = await runBlocker();
  if (blocked) redirect(`/settings/billing?blocked=${blocked.reason}`);
  const run = await createRun(orgKeyFor(profile), templateId);
  redirect(`/runs/${run.id}`);
}

async function withRun(runId: string, fn: (run: Run, countries: Country[]) => Promise<unknown>): Promise<RunActionResult> {
  const owned = await getOwnedRun(runId);
  if (!owned) return { error: "Run not found." };
  try {
    await fn(owned.run, owned.profile.countries);
  } catch (error) {
    if (error instanceof RunInputError) return { error: error.message, view: await buildRunView(runId) };
    throw error;
  }
  return { view: await buildRunView(runId) };
}

export async function answer(runId: string, questionId: string, value: string): Promise<RunActionResult> {
  return withRun(runId, (run) => answerQuestion(run, questionId, value));
}

export async function setFieldColumn(runId: string, slotKey: string, fieldKey: string, column: string | null): Promise<RunActionResult> {
  return withRun(runId, (run) => overrideMapping(run, slotKey, fieldKey, column));
}

export async function reconcileRun(runId: string): Promise<RunActionResult> {
  const blocked = await runBlocker();
  if (blocked) return { error: blocked.message };
  return withRun(runId, (run, countries) => runReconciliation(run, countries));
}
