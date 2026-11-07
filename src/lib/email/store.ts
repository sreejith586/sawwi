import { getDb, type Row } from "@/lib/db";

// All SQL for email (D-45): each user's on/off switches, and who in a workspace gets what.
// A user with no row has everything on.

export type EmailPrefs = { reminders: boolean; notices: boolean };
export type EmailTopic = keyof EmailPrefs;
export type Recipient = { userId: string; email: string; name: string; access: string };

export async function getEmailPrefs(userId: string): Promise<EmailPrefs> {
  const r = await getDb().get("SELECT reminders, notices FROM email_prefs WHERE user_id = ?", userId);
  return { reminders: r ? Number(r.reminders) === 1 : true, notices: r ? Number(r.notices) === 1 : true };
}

export async function setEmailPrefs(userId: string, prefs: EmailPrefs) {
  await getDb().run(
    `INSERT INTO email_prefs (user_id, reminders, notices, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET reminders = excluded.reminders, notices = excluded.notices, updated_at = excluded.updated_at`,
    userId,
    prefs.reminders ? 1 : 0,
    prefs.notices ? 1 : 0,
    new Date().toISOString(),
  );
}

/**
 * Members of an active workspace with one of these roles who have this topic switched on.
 * Deactivated teammates are left out (owners can't be deactivated), like at sign-in.
 */
export async function recipients(orgKey: string, accesses: string[], topic: EmailTopic): Promise<Recipient[]> {
  if (accesses.length === 0) return [];
  const column = topic === "reminders" ? "p.reminders" : "p.notices";
  const rows = await getDb().all(
    `SELECT u.id, u.email, u.name, m.access FROM orgs o
       JOIN memberships m ON m.org_id = o.id
       JOIN users u ON u.id = m.user_id
       LEFT JOIN members mb ON mb.org_key = o.key AND mb.email = u.email
       LEFT JOIN email_prefs p ON p.user_id = u.id
     WHERE o.key = ? AND o.status = 'active' AND m.access IN (${accesses.map(() => "?").join(", ")})
       AND (m.access = 'owner' OR mb.status IS NULL OR mb.status <> 'deactivated')
       AND COALESCE(${column}, 1) = 1
     ORDER BY m.created_at`,
    orgKey,
    ...accesses,
  );
  return rows.map((r: Row) => ({ userId: String(r.id), email: String(r.email), name: String(r.name), access: String(r.access) }));
}
