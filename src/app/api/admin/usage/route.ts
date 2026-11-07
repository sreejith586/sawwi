import { getCurrentSession } from "@/lib/saas/session";
import { usageExport } from "@/lib/usage/export";

// Cross-workspace usage export: superadmins only, everyone else gets a 404.
export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.isSuperadmin) return Response.json({ error: "Not found." }, { status: 404 });
  return usageExport(request, null, "sawwi-usage-all-workspaces");
}
