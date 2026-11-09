import { exportCsv } from "@/lib/automation/settlements/service";
import { getCurrentSession } from "@/lib/saas/session";

// Settlement journals as CSV (D-70): ?ids=a,b, or ?approved=1 for every approved one.
export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return Response.json({ error: "Log in again." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const ids = params.get("approved") ? "approved" : (params.get("ids") ?? "").split(",").filter(Boolean).slice(0, 500);
  const out = await exportCsv(session.org.key, ids);
  if (out.count === 0) return Response.json({ error: "No settlements to export." }, { status: 404 });
  return new Response(out.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${out.name}"`, "Cache-Control": "no-store" } });
}
