import { getCurrentSession } from "@/lib/saas/session";
import type { Profile } from "./profile";

/** The signed-in workspace's business profile, tagged with the workspace key runs are filed under. */
export type WorkspaceProfile = Profile & { orgKey: string };

// The profile lives on the workspace (orgs.profile_json) now; it used to be a cookie.
export async function getProfile(): Promise<WorkspaceProfile | undefined> {
  const session = await getCurrentSession();
  const profile = session?.org.profile;
  return profile && session ? { ...profile, orgKey: session.org.key } : undefined;
}
