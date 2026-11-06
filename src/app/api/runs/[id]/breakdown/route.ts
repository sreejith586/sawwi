import { tableWorkbook, xlsxResponse } from "@/lib/excel/sheet";
import { dimensionsFor } from "@/lib/insights/chat";
import { breakdown } from "@/lib/insights/facts";
import { getOwnedRun } from "@/lib/runs/access";
import { loadRunDatasets } from "@/lib/runs/reconcile";
import { getResult } from "@/lib/runs/store";
import { templateForRun } from "@/lib/runs/templates";

// Excel download of a chat breakdown (one check's exceptions grouped by key, month, SKU...).
// Read-only, like the other report exports, so viewers can download it too.
export async function GET(request: Request, ctx: RouteContext<"/api/runs/[id]/breakdown">) {
  const { id } = await ctx.params;
  const owned = await getOwnedRun(id);
  const result = owned && getResult(id);
  const template = owned && templateForRun(owned.run);
  if (!owned || !result || !template) return Response.json({ error: "Report not found." }, { status: 404 });

  const params = new URL(request.url).searchParams;
  const checkId = params.get("check") ?? "";
  const check = result.checks.find((c) => c.id === checkId);
  const dim = check && dimensionsFor(owned.run, template, checkId).find((d) => d.key === params.get("by"));
  if (!check || !dim) return Response.json({ error: "Unknown breakdown." }, { status: 400 });

  const { rows } = breakdown(template, result, loadRunDatasets(owned.run), checkId, dim.key);
  const cur = result.currency ? ` (${result.currency})` : "";
  const bytes = await tableWorkbook({
    sheetName: `${check.label} by ${dim.label}`,
    columns: [
      { header: dim.label, key: "group", type: "text" },
      { header: "Exceptions", key: "count", type: "number" },
      { header: `Value${cur}`, key: "value", type: "money" },
    ],
    rows,
  });
  return xlsxResponse(bytes, `${template.id}-${checkId}-by-${dim.key}-${result.asOf}.xlsx`);
}
