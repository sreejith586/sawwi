"use server";

import { refresh } from "next/cache";
import { inviteMember, isAccess, removeMember, setMemberAccess, setMemberActive, type InviteErrors } from "@/lib/accounts/members";
import { getProfile } from "@/lib/profile/session";
import { orgKeyFor } from "@/lib/runs/access";

async function orgKey(): Promise<string> {
  const profile = await getProfile();
  if (!profile) throw new Error("Set up your profile first.");
  return orgKeyFor(profile);
}

export type InviteValues = { name: string; email: string; access: string; team: string };
/** Values come back on errors so the form (which React resets after each submit) keeps what was typed. */
export type InviteState = { errors: InviteErrors; values?: InviteValues; invited?: string };

export async function invite(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const values: InviteValues = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    access: String(formData.get("access") ?? ""),
    team: String(formData.get("team") ?? ""),
  };
  const { member, errors } = inviteMember(await orgKey(), values);
  if (!member) return { errors, values };
  refresh();
  return { errors: {}, invited: member.email };
}

export async function changeAccess(id: string, access: string) {
  if (!isAccess(access)) return;
  setMemberAccess(await orgKey(), id, access);
  refresh();
}

export async function setActive(id: string, active: boolean) {
  setMemberActive(await orgKey(), id, active);
  refresh();
}

export async function remove(id: string) {
  removeMember(await orgKey(), id);
  refresh();
}
