import { getProfile } from "@/lib/profile/session";
import type { Profile } from "@/lib/profile/profile";
import * as store from "./store";
import type { Run } from "./types";

// Until auth lands, a run belongs to the company in the profile cookie.
export function orgKeyFor(profile: Profile): string {
  return profile.company.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "default";
}

export async function getOwnedRun(runId: string): Promise<{ run: Run; profile: Profile } | undefined> {
  const profile = await getProfile();
  if (!profile) return undefined;
  const run = store.getRun(runId);
  if (!run || run.orgKey !== orgKeyFor(profile)) return undefined;
  return { run, profile };
}
