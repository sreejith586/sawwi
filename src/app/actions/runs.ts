"use server";

import { redirect } from "next/navigation";
import { getProfile } from "@/lib/profile/session";
import { getOwnedRun, orgKeyFor } from "@/lib/runs/access";
import { answerQuestion, overrideMapping, RunInputError } from "@/lib/runs/engine";
import { createRun } from "@/lib/runs/store";
import type { Run } from "@/lib/runs/types";
import { buildRunView, type RunView } from "@/lib/runs/view";
import { getTemplate } from "@/lib/templates/catalog";

export type RunActionResult = { view?: RunView; error?: string };

export async function startRun(templateId: string) {
  const profile = await getProfile();
  if (!profile) redirect("/onboarding");
  if (!getTemplate(templateId)) throw new Error("Unknown template");
  const run = createRun(orgKeyFor(profile), templateId);
  redirect(`/runs/${run.id}`);
}

async function withRun(runId: string, fn: (run: Run) => void): Promise<RunActionResult> {
  const owned = await getOwnedRun(runId);
  if (!owned) return { error: "Run not found." };
  try {
    fn(owned.run);
  } catch (error) {
    if (error instanceof RunInputError) return { error: error.message, view: buildRunView(runId) };
    throw error;
  }
  return { view: buildRunView(runId) };
}

export async function answer(runId: string, questionId: string, value: string): Promise<RunActionResult> {
  return withRun(runId, (run) => answerQuestion(run, questionId, value));
}

export async function setFieldColumn(runId: string, slotKey: string, fieldKey: string, column: string | null): Promise<RunActionResult> {
  return withRun(runId, (run) => overrideMapping(run, slotKey, fieldKey, column));
}
