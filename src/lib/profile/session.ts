import { cookies } from "next/headers";
import { decodeProfileCookie, PROFILE_COOKIE, type Profile } from "./profile";

// Phase 1 keeps the seller profile in a cookie. It moves to Postgres with auth in a later phase.
export async function getProfile(): Promise<Profile | undefined> {
  return decodeProfileCookie((await cookies()).get(PROFILE_COOKIE)?.value);
}
