import { draftsCsv } from "@/lib/automation/purchase-invoices/draft";
import { draftsForExport } from "@/lib/automation/purchase-invoices/service";
import { getCurrentSession } from "@/lib/saas/session";

// CSV of purchase invoice drafts (D-65): ?ids=a,b for chosen drafts, or ?approved=1 for every
// approved one. One row per line, the header repeated.
export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return Response.json({ error: "Log in again." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const ids = params.get("approved") ? "approved" : (params.get("ids") ?? "").split(",").filter(Boolean).slice(0, 500);
  const drafts = await draftsForExport(session.org.key, ids);
  if (drafts.length === 0) return Response.json({ error: "No invoices to export." }, { status: 404 });
  const name = drafts.length === 1 ? `purchase-invoice-${drafts[0].draft.invoiceNumber.replace(/[^\w-]+/g, "_") || "draft"}.csv` : `purchase-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(draftsCsv(drafts.map((d) => d.draft)), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
