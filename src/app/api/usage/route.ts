import { getCurrentSession } from "@/lib/saas/session";
import { usageExport } from "@/lib/usage/export";

// Excel download of the workspace's usage tables. Read-only, so every member
// (viewers included) can download it, like the other reports.
export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return Response.json({ error: "Log in first." }, { status: 401 });
  return usageExport(request, session.org.key, "sawwi-usage");
}
