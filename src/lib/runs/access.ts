import { getProfile } from "@/lib/profile/session";
import type { Profile } from "@/lib/profile/profile";
import * as store from "./store";
import type { Run } from "./types";

// Runs belong to the signed-in workspace. Its key is fixed at sign-up, so renaming the
// company never orphans its runs; the name-derived fallback only covers old callers.
export function orgKeyFor(profile: Profile & { orgKey?: string }): string {
  if (profile.orgKey) return profile.orgKey;
  return profile.company.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "default";
}

export async function getOwnedRun(runId: string): Promise<{ run: Run; profile: Profile } | undefined> {
  const profile = await getProfile();
  if (!profile) return undefined;
  const run = store.getRun(runId);
  if (!run || run.orgKey !== orgKeyFor(profile)) return undefined;
  return { run, profile };
}
