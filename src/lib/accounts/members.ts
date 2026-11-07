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

export async function listMembers(orgKey: string): Promise<Member[]> {
  return ((await getDb().all("SELECT * FROM members WHERE org_key = ? ORDER BY invited_at", orgKey)) as Row[]).map(toMember);
}

export type InviteInput = { name: unknown; email: unknown; access: unknown; team: unknown };
export type InviteErrors = Partial<Record<"name" | "email" | "access", string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function inviteMember(orgKey: string, input: InviteInput): Promise<{ member?: Member; errors: InviteErrors }> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const errors: InviteErrors = {};
  if (!name) errors.name = "Enter their name.";
  if (!EMAIL.test(email)) errors.email = "Enter a valid email address.";
  if (!isAccess(input.access)) errors.access = "Pick an access level.";
  if (!errors.email && (await getDb().get("SELECT 1 FROM members WHERE org_key = ? AND email = ?", orgKey, email))) {
    errors.email = "This person is already on the team.";
  }
  if (Object.keys(errors).length) return { errors };

  const team = ROLES.some((r) => r.value === input.team) ? (input.team as Role) : undefined;
  const member: Member = { id: randomUUID(), name, email, access: input.access as Access, team, status: "invited", invitedAt: new Date().toISOString() };
  await getDb().run("INSERT INTO members (id, org_key, name, email, access, team, status, invited_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", member.id, orgKey, member.name, member.email, member.access, member.team ?? null, member.status, member.invitedAt);
  return { member, errors };
}

export async function setMemberAccess(orgKey: string, id: string, access: Access) {
  await getDb().run("UPDATE members SET access = ? WHERE org_key = ? AND id = ?", access, orgKey, id);
}

/** Deactivating keeps the person on the roster (and in history) but blocks access once auth exists. */
export async function setMemberActive(orgKey: string, id: string, active: boolean) {
  const m = (await getDb().get("SELECT status FROM members WHERE org_key = ? AND id = ?", orgKey, id)) as Row | undefined;
  if (!m) return;
  // Reactivating someone who never accepted puts them back to "invited".
  const next = active ? "invited" : "deactivated";
  await getDb().run("UPDATE members SET status = ? WHERE org_key = ? AND id = ?", next, orgKey, id);
}

export async function removeMember(orgKey: string, id: string) {
  await getDb().run("DELETE FROM members WHERE org_key = ? AND id = ?", orgKey, id);
}

export async function countInvited(orgKey: string): Promise<number> {
  return Number(((await getDb().get("SELECT COUNT(*) AS n FROM members WHERE org_key = ? AND status = 'invited'", orgKey)) as Row).n);
}

export async function findMemberByEmail(orgKey: string, email: string): Promise<Member | undefined> {
  const r = (await getDb().get("SELECT * FROM members WHERE org_key = ? AND email = ?", orgKey, email.trim().toLowerCase())) as Row | undefined;
  return r ? toMember(r) : undefined;
}

/** Open invites for an email across every workspace, oldest first (used at sign-up). */
export async function invitesForEmail(email: string): Promise<(Member & { orgKey: string })[]> {
  return ((await getDb().all("SELECT * FROM members WHERE email = ? AND status = 'invited' ORDER BY invited_at", email.trim().toLowerCase())) as Row[]).map((r) => ({
    ...toMember(r),
    orgKey: String(r.org_key),
  }));
}

/** An invite becomes "active" once the person signs up and joins. */
export async function markMemberJoined(orgKey: string, email: string) {
  await getDb().run("UPDATE members SET status = 'active' WHERE org_key = ? AND email = ?", orgKey, email.trim().toLowerCase());
}

export async function getMember(orgKey: string, id: string): Promise<Member | undefined> {
  const r = (await getDb().get("SELECT * FROM members WHERE org_key = ? AND id = ?", orgKey, id)) as Row | undefined;
  return r ? toMember(r) : undefined;
}
