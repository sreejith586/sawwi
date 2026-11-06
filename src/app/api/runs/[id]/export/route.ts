import { buildWorkbook, type ExportTable } from "@/lib/recon/excel";
import { queryFromParams } from "@/lib/recon/table";
import { getOwnedRun } from "@/lib/runs/access";
import { loadRunDatasets } from "@/lib/runs/reconcile";
import { getResult } from "@/lib/runs/store";
import { buildReport } from "@/lib/runs/view";
import { getTemplate } from "@/lib/templates/catalog";

const TABLES: ExportTable[] = ["checks", "exceptions", "links", "all"];

// Excel download of a report table, filtered and sorted exactly like the screen.
export async function GET(request: Request, ctx: RouteContext<"/api/runs/[id]/export">) {
  const { id } = await ctx.params;
  const owned = await getOwnedRun(id);
  const result = owned && getResult(id);
  const template = owned && getTemplate(owned.run.templateId);
  if (!owned || !result || !template) return Response.json({ error: "Report not found." }, { status: 404 });

  const params = new URL(request.url).searchParams;
  const table = TABLES.find((t) => t === params.get("table")) ?? "all";
  const report = buildReport(template, result, Number.MAX_SAFE_INTEGER);
  const query = queryFromParams(params, table === "checks" ? ["severity", "status"] : ["check", "severity"]);
  const datasets = table === "exceptions" || table === "all" ? loadRunDatasets(owned.run) : undefined;
  const bytes = await buildWorkbook(report, table, query, datasets);

  const name = `${template.id}-${table}-${result.asOf}.xlsx`;
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
