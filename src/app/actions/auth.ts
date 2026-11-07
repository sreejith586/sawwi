"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { invitesForEmail, markMemberJoined } from "@/lib/accounts/members";
import { decodeProfileCookie, PROFILE_COOKIE } from "@/lib/profile/profile";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "@/lib/saas/password";
import { sendSoon } from "@/lib/email/queue";
import { requestPasswordReset, resetPassword } from "@/lib/saas/reset";
import { endSession, startSession } from "@/lib/saas/session";
import * as store from "@/lib/saas/store";

export type AuthFields = { name?: string; email?: string; company?: string };
export type AuthState = { error?: string; fieldErrors?: Partial<Record<"name" | "email" | "password" | "company", string>>; values?: AuthFields };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

/** Only same-site relative paths, so ?next= can't bounce people to another site. */
function safeNext(raw: FormDataEntryValue | null, fallback: string) {
  const next = str(raw);
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
}

/** Joins every workspace this email was invited to. Returns the first one joined. */
async function acceptInvites(user: store.User): Promise<store.Org | undefined> {
  let first: store.Org | undefined;
  for (const invite of await invitesForEmail(user.email)) {
    const org = await store.getOrgByKey(invite.orgKey);
    if (!org) continue;
    await store.addMembership(org.id, user.id, invite.access);
    await markMemberJoined(org.key, user.email);
    first ??= org;
  }
  return first;
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const settings = await store.getSettings();
  const values: AuthFields = { name: str(formData.get("name")), email: str(formData.get("email")).toLowerCase(), company: str(formData.get("company")) };
  const password = typeof formData.get("password") === "string" ? String(formData.get("password")) : "";
  const invited = values.email ? (await invitesForEmail(values.email)).length > 0 : false;

  if (!settings.signupsOpen && !invited) return { error: "Sign-ups are closed right now. Ask your team to invite you.", values };

  const fieldErrors: AuthState["fieldErrors"] = {};
  if (!values.name) fieldErrors.name = "Enter your name.";
  if (!EMAIL.test(values.email ?? "")) fieldErrors.email = "Enter a valid work email.";
  if (password.length < MIN_PASSWORD_LENGTH) fieldErrors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (!invited && !values.company) fieldErrors.company = "Enter your company name.";
  if (!fieldErrors.email && await store.findUserByEmail(values.email!)) fieldErrors.email = "There's already an account with this email. Log in instead.";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };

  const user = await store.createUser(values.email!, values.name!, await hashPassword(password));
  let org = await acceptInvites(user);
  if (!org) {
    // Carry over a profile saved before accounts existed, if it's for the same company.
    const legacy = decodeProfileCookie((await cookies()).get(PROFILE_COOKIE)?.value);
    org = await store.createOrg(values.company!, settings.trialDays, legacy?.company.toLowerCase() === values.company!.toLowerCase() ? legacy : undefined);
    await store.addMembership(org.id, user.id, "owner");
  }
  (await cookies()).delete(PROFILE_COOKIE);
  await startSession(user.id, org);
  redirect(org.profile ? "/home" : "/onboarding");
}

// Simple in-memory brake on password guessing (per email, per server process).
const failures = new Map<string, { count: number; until: number }>();
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;

export async function logIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = str(formData.get("email")).toLowerCase();
  const password = typeof formData.get("password") === "string" ? String(formData.get("password")) : "";
  const values = { email };

  const f = failures.get(email);
  if (f && f.count >= MAX_FAILURES && f.until > Date.now()) return { error: "Too many attempts. Try again in 15 minutes.", values };

  const user = email ? await store.findUserByEmail(email) : undefined;
  const valid = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !valid) {
    const count = (f && f.until > Date.now() ? f.count : 0) + 1;
    failures.set(email, { count, until: Date.now() + LOCK_MS });
    return { error: "That email and password don't match.", values };
  }
  failures.delete(email);

  await acceptInvites(user);
  const membership = (await store.membershipsForUser(user.id))[0];
  const org = membership && await store.getOrg(membership.orgId);
  if (!org) return { error: "This account isn't part of a workspace any more. Ask your team to invite you again.", values };

  await startSession(user.id, org);
  redirect(org.profile ? safeNext(formData.get("next"), "/home") : "/onboarding");
}

export async function signOut() {
  await endSession();
  redirect("/");
}

// ─── Password reset (D-46) ───────────────────────────────────────────────

export type ForgotState = { sent?: boolean; email?: string; error?: string };

/** The client's address, for rate limiting only (hashed before it's stored). */
async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "";
}

export async function forgotPassword(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const email = str(formData.get("email")).toLowerCase();
  if (!EMAIL.test(email)) return { error: "Enter the email you log in with.", email };
  const outcome = await requestPasswordReset(email, await clientIp());
  if (outcome.limited) return { error: "Too many reset requests from here. Try again in an hour.", email };
  // Sent after the response, so answering takes the same time whether or not there's an account.
  if (outcome.emailKey) sendSoon([outcome.emailKey]);
  return { sent: true, email };
}

export type ResetState = { error?: string; fieldError?: string };

export async function completeReset(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const token = str(formData.get("token"));
  const password = typeof formData.get("password") === "string" ? String(formData.get("password")) : "";
  const result = await resetPassword(token, password);
  if (!result.ok) return result.field ? { fieldError: result.error } : { error: result.error };
  redirect("/login?reset=1");
}
