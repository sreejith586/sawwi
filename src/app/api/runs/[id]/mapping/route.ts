import { tableWorkbook, xlsxResponse } from "@/lib/excel/sheet";
import { applyQuery, queryFromParams } from "@/lib/recon/table";
import { getOwnedRun } from "@/lib/runs/access";
import { buildRunView } from "@/lib/runs/view";
import { MAPPING_FILTERS, MAPPING_SEARCH, mappingRows } from "@/lib/tables/rows";

// Excel download of a file's column mapping, filtered and sorted like the on-screen table.
export async function GET(request: Request, ctx: RouteContext<"/api/runs/[id]/mapping">) {
  const { id } = await ctx.params;
  const owned = await getOwnedRun(id);
  const view = owned && buildRunView(id);
  const params = new URL(request.url).searchParams;
  const slot = view?.slots.find((s) => s.key === params.get("slot"));
  if (!view || !slot?.file) return Response.json({ error: "Mapping not found." }, { status: 404 });

  const rows = applyQuery(mappingRows(slot), queryFromParams(params, MAPPING_FILTERS), [...MAPPING_SEARCH]);
  const bytes = await tableWorkbook({
    sheetName: `${slot.label} mapping`,
    columns: [
      { header: "Sawwi field", key: "field" },
      { header: "Required", key: "required" },
      { header: `Column in ${slot.file.name}`, key: "column" },
      { header: "Status", key: "status" },
      { header: "Matched by", key: "source" },
    ],
    rows,
  });
  return xlsxResponse(bytes, `${view.templateId}-${slot.key}-mapping`);
}
