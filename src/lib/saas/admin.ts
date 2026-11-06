import { notFound } from "next/navigation";
import { getCurrentSession } from "./session";

/** Page guard: anyone who isn't a superadmin gets a plain 404, so the console isn't advertised. */
export async function requireSuperadminPage() {
  const session = await getCurrentSession();
  if (!session?.isSuperadmin) notFound();
  return session;
}
