import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { ROLES, type Role } from "@/lib/profile/options";
import { isAccess, type Access } from "./access";

export { ACCESS, isAccess, type Access } from "./access";

// Team members per company. Until auth lands this is a roster only: invites are recorded,
// no email goes out and nobody can sign in with them yet. The person using this browser is
// the workspace owner and is not stored here.

export type MemberStatus = "invited" | "active" | "deactivated";

export type Member = {
  id: string;
  name: string;
  email: string;
  access: Access;
  team?: Role;
  status: MemberStatus;
  invitedAt: string;
};

let ready = false;
function db() {
  const d = getDb();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      org_key TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      access TEXT NOT NULL,
      team TEXT,
      status TEXT NOT NULL,
      invited_at TEXT NOT NULL,
      UNIQUE (org_key, email)
    )`);
    ready = true;
  }
  return d;
}

type Row = Record<string, string | null>;
const toMember = (r: Row): Member => ({
  id: String(r.id),
  name: String(r.name),
  email: String(r.email),
  access: r.access as Access,
  team: (r.team ?? undefined) as Role | undefined,
  status: r.status as MemberStatus,
  invitedAt: String(r.invited_at),
});

export function listMembers(orgKey: string): Member[] {
  return (db().prepare("SELECT * FROM members WHERE org_key = ? ORDER BY invited_at").all(orgKey) as Row[]).map(toMember);
}

export type InviteInput = { name: unknown; email: unknown; access: unknown; team: unknown };
export type InviteErrors = Partial<Record<"name" | "email" | "access", string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function inviteMember(orgKey: string, input: InviteInput): { member?: Member; errors: InviteErrors } {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const errors: InviteErrors = {};
  if (!name) errors.name = "Enter their name.";
  if (!EMAIL.test(email)) errors.email = "Enter a valid email address.";
  if (!isAccess(input.access)) errors.access = "Pick an access level.";
  if (!errors.email && db().prepare("SELECT 1 FROM members WHERE org_key = ? AND email = ?").get(orgKey, email)) {
    errors.email = "This person is already on the team.";
  }
  if (Object.keys(errors).length) return { errors };

  const team = ROLES.some((r) => r.value === input.team) ? (input.team as Role) : undefined;
  const member: Member = { id: randomUUID(), name, email, access: input.access as Access, team, status: "invited", invitedAt: new Date().toISOString() };
  db()
    .prepare("INSERT INTO members (id, org_key, name, email, access, team, status, invited_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(member.id, orgKey, member.name, member.email, member.access, member.team ?? null, member.status, member.invitedAt);
  return { member, errors };
}

export function setMemberAccess(orgKey: string, id: string, access: Access) {
  db().prepare("UPDATE members SET access = ? WHERE org_key = ? AND id = ?").run(access, orgKey, id);
}

/** Deactivating keeps the person on the roster (and in history) but blocks access once auth exists. */
export function setMemberActive(orgKey: string, id: string, active: boolean) {
  const m = db().prepare("SELECT status FROM members WHERE org_key = ? AND id = ?").get(orgKey, id) as Row | undefined;
  if (!m) return;
  // Reactivating someone who never accepted puts them back to "invited".
  const next = active ? "invited" : "deactivated";
  db().prepare("UPDATE members SET status = ? WHERE org_key = ? AND id = ?").run(next, orgKey, id);
}

export function removeMember(orgKey: string, id: string) {
  db().prepare("DELETE FROM members WHERE org_key = ? AND id = ?").run(orgKey, id);
}
