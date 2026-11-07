import { getDb } from "@/lib/db";

// All SQL for password resets (D-46). Only a hash of each reset token is stored, like sessions.
// reset_requests records every request (known email or not) by hashed email and hashed IP,
// for rate limiting, and is pruned after a day.

export async function insertReset(r: { id: string; userId: string; tokenHash: string; createdAt: Date; expiresAt: Date }) {
  await getDb().run(
    "INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    r.id,
    r.userId,
    r.tokenHash,
    r.createdAt.toISOString(),
    r.expiresAt.toISOString(),
  );
}

/** The user a live (unused, unexpired) token belongs to, without using it up. */
export async function peekReset(tokenHash: string, now: Date): Promise<string | undefined> {
  const r = await getDb().get("SELECT user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?", tokenHash, now.toISOString());
  return r ? String(r.user_id) : undefined;
}

/** Uses the token up, atomically: two submits of the same link can't both succeed. */
export async function consumeReset(tokenHash: string, now: Date): Promise<string | undefined> {
  const r = await getDb().get(
    "UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id",
    now.toISOString(),
    tokenHash,
    now.toISOString(),
  );
  return r ? String(r.user_id) : undefined;
}

/** After a reset: every other link for this user stops working. */
export async function voidResetsForUser(userId: string, now: Date) {
  await getDb().run("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL", now.toISOString(), userId);
}

export async function setPasswordHash(userId: string, passwordHash: string) {
  await getDb().run("UPDATE users SET password_hash = ? WHERE id = ?", passwordHash, userId);
}

/** Signs the user out everywhere: a reset usually means someone else may know the old password. */
export async function deleteSessionsForUser(userId: string) {
  await getDb().run("DELETE FROM sessions WHERE user_id = ?", userId);
}

export async function recordResetRequest(emailHash: string, ipHash: string, at: Date) {
  await getDb().run("INSERT INTO reset_requests (email_hash, ip_hash, created_at) VALUES (?, ?, ?)", emailHash, ipHash, at.toISOString());
}

export async function countResetRequests(by: "email" | "ip", hash: string, since: Date): Promise<number> {
  const column = by === "email" ? "email_hash" : "ip_hash";
  const r = await getDb().get(`SELECT COUNT(*) AS n FROM reset_requests WHERE ${column} = ? AND created_at > ?`, hash, since.toISOString());
  return Number(r?.n ?? 0);
}

/** Old requests and finished or expired links go after a day. */
export async function pruneResets(before: Date): Promise<number> {
  const at = before.toISOString();
  const a = await getDb().run("DELETE FROM reset_requests WHERE created_at < ?", at);
  const b = await getDb().run("DELETE FROM password_resets WHERE expires_at < ?", at);
  return a.changes + b.changes;
}
