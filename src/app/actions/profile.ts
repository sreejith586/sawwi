"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { parseProfile, PROFILE_COOKIE, type ProfileErrors } from "@/lib/profile/profile";

export type SaveProfileState = { errors: ProfileErrors };

export async function saveProfile(_prev: SaveProfileState, formData: FormData): Promise<SaveProfileState> {
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

  (await cookies()).set(PROFILE_COOKIE, JSON.stringify(profile), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/templates");
}

export async function resetProfile() {
  (await cookies()).delete(PROFILE_COOKIE);
  redirect("/onboarding");
}
