"use server";

import { refresh } from "next/cache";
import { getMember, inviteMember, isAccess, markMemberJoined, removeMember, setMemberAccess, setMemberActive, type InviteErrors } from "@/lib/accounts/members";
import * as store from "@/lib/saas/store";
import type { Org } from "@/lib/saas/store";
import { canManageTeam, getCurrentSession, orgEntitlement } from "@/lib/saas/session";

/** Team changes need an owner or admin of the signed-in workspace. */
async function team() {
  const session = await getCurrentSession();
  if (!session || !canManageTeam(session.access)) throw new Error("Only workspace owners and admins can manage the team.");
  return session.org;
}

/** The signed-up account behind a roster entry, if that person has joined. */
function joinedUser(org: Org, memberId: string) {
  const member = getMember(org.key, memberId);
  const user = member && store.findUserByEmail(member.email);
  return member && user && store.getMembership(org.id, user.id) ? { member, user } : undefined;
}

export type InviteValues = { name: string; email: string; access: string; team: string };
/** Values come back on errors so the form (which React resets after each submit) keeps what was typed. */
export type InviteState = { errors: InviteErrors; values?: InviteValues; invited?: string };

export async function invite(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const session = await getCurrentSession();
  if (!session || !canManageTeam(session.access)) return { errors: { email: "Only workspace owners and admins can invite people." } };
  const seats = orgEntitlement(session.org, "invite");
  if (!seats.ok) return { errors: { email: seats.message } };
  const values: InviteValues = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    access: String(formData.get("access") ?? ""),
    team: String(formData.get("team") ?? ""),
  };
  const { member, errors } = inviteMember(session.org.key, values);
  if (!member) return { errors, values };
  refresh();
  return { errors: {}, invited: member.email };
}

export async function changeAccess(id: string, access: string) {
  if (!isAccess(access)) return;
  const org = await team();
  setMemberAccess(org.key, id, access);
  const joined = joinedUser(org, id);
  if (joined) store.addMembership(org.id, joined.user.id, access);
  refresh();
}

export async function setActive(id: string, active: boolean) {
  const org = await team();
  setMemberActive(org.key, id, active);
  // Someone who already joined goes straight back to "active", not "invited".
  const joined = joinedUser(org, id);
  if (active && joined) markMemberJoined(org.key, joined.member.email);
  refresh();
}

export async function remove(id: string) {
  const org = await team();
  const joined = joinedUser(org, id);
  if (joined) store.removeMembership(org.id, joined.user.id);
  removeMember(org.key, id);
  refresh();
}
