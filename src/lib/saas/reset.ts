import { createHash, randomBytes, randomUUID } from "node:crypto";
import { queueEmail } from "@/lib/email/queue";
import { appUrl } from "@/lib/site";
import { hashPassword, MIN_PASSWORD_LENGTH } from "./password";
import * as resets from "./reset-store";
import { findUserByEmail } from "./store";

// Password reset (D-46). A link holds a 256-bit random token; only its SHA-256 is stored, so a
// database leak gives nobody a working link. A link works once, for an hour. Asking for one
// never says whether the email has an account: the answer and the work are the same either way,
// and the email itself goes out after the response.

export const RESET_TTL_MS = 60 * 60_000;
export const RESET_LIMITS = { perEmail: 3, perIp: 10, windowMs: 60 * 60_000 };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type ResetRequest = {
  /** Too many requests from this address: the only answer that differs, and it says nothing about the email. */
  limited: boolean;
  /** Job key of the queued email, if one was queued (never shown to the person asking). */
  emailKey?: string;
};

export async function requestPasswordReset(rawEmail: string, ip: string, now = new Date()): Promise<ResetRequest> {
  const email = rawEmail.trim().toLowerCase();
  const ipHash = sha256(`ip:${ip || "unknown"}`);
  const since = new Date(now.getTime() - RESET_LIMITS.windowMs);
  if ((await resets.countResetRequests("ip", ipHash, since)) >= RESET_LIMITS.perIp) return { limited: true };

  const emailHash = sha256(`email:${email}`);
  await resets.recordResetRequest(emailHash, ipHash, now);
  // Over the per-email limit: answer as usual, send nothing. Stops someone flooding an inbox.
  if ((await resets.countResetRequests("email", emailHash, since)) > RESET_LIMITS.perEmail) return { limited: false };

  const user = email ? await findUserByEmail(email) : undefined;
  if (!user) return { limited: false };

  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  await resets.insertReset({ id, userId: user.id, tokenHash: sha256(token), createdAt: now, expiresAt: new Date(now.getTime() + RESET_TTL_MS) });
  const emailKey = `email:reset:${id}`;
  await queueEmail(emailKey, { to: user.email, template: "reset", data: { name: user.name, url: `${appUrl()}/reset-password?token=${token}`, minutes: RESET_TTL_MS / 60_000 }, sensitive: true }, now);
  return { limited: false, emailKey };
}

/** Whether a link still works, for the reset page. Doesn't use it up. */
export async function resetLinkValid(token: string, now = new Date()): Promise<boolean> {
  return Boolean(token) && Boolean(await resets.peekReset(sha256(token), now));
}

export type ResetResult = { ok: true; userId: string } | { ok: false; error: string; field?: "password" };

export async function resetPassword(token: string, password: string, now = new Date()): Promise<ResetResult> {
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, field: "password", error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  const hash = await hashPassword(password);
  const userId = token ? await resets.consumeReset(sha256(token), now) : undefined;
  if (!userId) return { ok: false, error: "This link has expired or was already used. Ask for a new one." };
  await resets.setPasswordHash(userId, hash);
  await resets.voidResetsForUser(userId, now);
  await resets.deleteSessionsForUser(userId);
  return { ok: true, userId };
}
