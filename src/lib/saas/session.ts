import { cookies } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";
import { findMemberByEmail } from "@/lib/accounts/members";
import { entitlement, type Entitlement } from "./plans";
import { ONBOARDED_COOKIE, SESSION_COOKIE } from "./cookies";
import * as store from "./store";

// Data access layer for "who is signed in". Every page, server action and route handler
// that needs the user or workspace goes through getCurrentSession(), which re-checks the
// session in the database: the proxy's cookie check is only an optimistic redirect.

export { ONBOARDED_COOKIE, SESSION_COOKIE };

export type CurrentSession = {
  user: store.User;
  org: store.Org;
  access: store.MembershipAccess;
  isSuperadmin: boolean;
};

/** Superadmins are set by env (comma-separated emails), so nobody can grant it from the app. */
export function isSuperadminEmail(email: string): boolean {
  return (process.env.SAWWI_SUPERADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

export const getCurrentSession = cache(async (): Promise<CurrentSession | undefined> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return undefined;
  // Session checks compare against the clock and hit the database: request time only.
  await connection();
  const s = store.readSession(token);
  if (!s) return undefined;
  const user = store.getUser(s.userId);
  const org = store.getOrg(s.orgId);
  const membership = store.getMembership(s.orgId, s.userId);
  if (!user || !org || !membership) return undefined;
  // A deactivated teammate keeps their login but loses this workspace.
  if (membership.access !== "owner" && findMemberByEmail(org.key, user.email)?.status === "deactivated") return undefined;
  return { user, org, access: membership.access, isSuperadmin: isSuperadminEmail(user.email) };
});

const cookieOptions = (expires?: Date) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  ...(expires ? { expires } : {}),
});

/** Call from a server action after verifying credentials. */
export async function startSession(userId: string, org: store.Org) {
  const { token, expiresAt } = store.createSession(userId, org.id);
  store.touchLogin(userId);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, cookieOptions(expiresAt));
  if (org.profile) jar.set(ONBOARDED_COOKIE, "1", cookieOptions(expiresAt));
  else jar.delete(ONBOARDED_COOKIE);
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) store.deleteSession(token);
  jar.delete(SESSION_COOKIE);
  jar.delete(ONBOARDED_COOKIE);
}

export async function markOnboarded() {
  (await cookies()).set(ONBOARDED_COOKIE, "1", cookieOptions(new Date(Date.now() + 30 * 86_400_000)));
}

export function orgEntitlement(org: store.Org, action: "run" | "invite" = "run"): Entitlement {
  return entitlement(store.billingState(org), store.getSettings().paywallEnabled, action);
}

export const canManageTeam = (access: store.MembershipAccess) => access === "owner" || access === "admin";
export const canRun = (access: store.MembershipAccess) => access !== "viewer";

export type RunBlock = { reason: string; message: string };

/** Why the signed-in user can't start or re-run a reconciliation right now, if anything. */
export async function runBlocker(): Promise<RunBlock | undefined> {
  const session = await getCurrentSession();
  if (!session) return { reason: "signed_out", message: "Your session has ended. Log in again." };
  if (!canRun(session.access)) return { reason: "viewer", message: "Viewers can open reports but can't start reconciliations. Ask an admin for Editor access." };
  const e = orgEntitlement(session.org, "run");
  return e.ok ? undefined : { reason: e.reason, message: e.message };
}
