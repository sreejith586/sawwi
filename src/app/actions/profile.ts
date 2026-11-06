"use server";

import { redirect } from "next/navigation";
import { parseProfile, type ProfileErrors } from "@/lib/profile/profile";
import { canManageTeam, getCurrentSession, markOnboarded } from "@/lib/saas/session";
import { saveOrgProfile } from "@/lib/saas/store";

export type SaveProfileState = { errors: ProfileErrors; error?: string };

export async function saveProfile(_prev: SaveProfileState, formData: FormData): Promise<SaveProfileState> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.org.profile && !canManageTeam(session.access)) {
    return { errors: {}, error: "Only workspace owners and admins can change the business profile." };
  }

  const { profile, errors } = parseProfile({
    company: formData.get("company"),
    role: formData.get("role"),
    countries: formData.getAll("countries"),
    accountingSystems: formData.getAll("accountingSystems"),
    channels: formData.getAll("channels"),
    marketplaces: formData.getAll("marketplaces"),
    sellsB2B: formData.get("sellsB2B") === "yes",
    usesMarketplaceFulfilment: formData.get("usesMarketplaceFulfilment") === "yes",
    platforms: formData.getAll("platforms"),
    payments: formData.getAll("payments"),
    b2bPayments: formData.getAll("b2bPayments"),
    givesCreditTerms: formData.get("givesCreditTerms") === "yes",
  });
  if (!profile) return { errors };

  saveOrgProfile(session.org.id, profile);
  await markOnboarded();
  redirect("/home");
}
