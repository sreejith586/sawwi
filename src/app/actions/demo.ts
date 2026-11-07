"use server";

import { redirect } from "next/navigation";
import { demoEnabled } from "@/lib/demo/enabled";
import { ensureDemoWorkspace, resetDemoIfDue } from "@/lib/demo/workspace";
import { startSession } from "@/lib/saas/session";

/**
 * "Try the live demo" (D-32): signs the visitor into the shared demo store, no account needed.
 * It replaces any session in this browser, like logging in as someone else.
 */
export async function startDemo() {
  if (!demoEnabled()) redirect("/signup");
  const { org, user } = await ensureDemoWorkspace();
  await resetDemoIfDue();
  await startSession(user.id, org);
  redirect("/home");
}
