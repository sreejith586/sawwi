import { draftsCsv } from "@/lib/automation/purchase-invoices/draft";
import { capturesWorkbook } from "@/lib/automation/purchase-invoices/excel";
import { currentTarget, draftsForExport, type ExportScope } from "@/lib/automation/purchase-invoices/service";

const SCOPES: ExportScope[] = ["all", "open", "failed", "approved", "pushed"];
import { xlsxResponse } from "@/lib/excel/sheet";
import { getCurrentSession } from "@/lib/saas/session";

// Purchase invoice drafts as CSV (D-65) or Excel (D-87): ?ids=a,b for chosen drafts, ?scope=all
// (or open, failed, approved, pushed) for a whole tab (D-90), or ?approved=1; &format=xlsx for Excel. CSV is one row per line with the
// header repeated; Excel adds an Invoices sheet with each invoice's status and what's still open.
export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return Response.json({ error: "Log in again." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  // ?scope= for a whole tab at once (D-90); ?approved=1 is the older spelling of scope=approved.
  const scope = params.get("scope");
  const ids: string[] | ExportScope = params.get("approved")
    ? "approved"
    : scope && SCOPES.includes(scope as ExportScope)
      ? (scope as ExportScope)
      : (params.get("ids") ?? "").split(",").filter(Boolean).slice(0, 500);
  const drafts = await draftsForExport(session.org.key, ids);
  if (drafts.length === 0) return Response.json({ error: "No invoices to export." }, { status: 404 });
  const base = drafts.length === 1 ? `purchase-invoice-${drafts[0].draft.invoiceNumber.replace(/[^\w-]+/g, "_") || "draft"}` : `purchase-invoices-${new Date().toISOString().slice(0, 10)}`;
  if (params.get("format") === "xlsx") {
    const erp = Boolean(await currentTarget(session.org.key));
    return xlsxResponse(await capturesWorkbook(drafts, { erp }), `${base}.xlsx`);
  }
  return new Response(draftsCsv(drafts.map((d) => d.draft)), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"`, "Cache-Control": "no-store" },
  });
}
