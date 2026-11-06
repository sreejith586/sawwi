import { tableWorkbook, xlsxResponse } from "@/lib/excel/sheet";
import { applyQuery, queryFromParams } from "@/lib/recon/table";
import { getTemplate } from "@/lib/templates/catalog";
import { SPEC_FILTERS, SPEC_SEARCH, specRows } from "@/lib/tables/rows";

// Excel download of the columns a template looks for, so teams can prepare their exports.
export async function GET(request: Request, ctx: RouteContext<"/api/templates/[id]/spec">) {
  const { id } = await ctx.params;
  const template = getTemplate(id);
  if (!template) return Response.json({ error: "Template not found." }, { status: 404 });

  const params = new URL(request.url).searchParams;
  const rows = applyQuery(specRows(template), queryFromParams(params, SPEC_FILTERS), [...SPEC_SEARCH]);
  const bytes = await tableWorkbook({
    sheetName: "Columns",
    columns: [
      { header: "File", key: "file" },
      { header: "Column", key: "field" },
      { header: "Type", key: "type" },
      { header: "Required", key: "required" },
      { header: "Typical exports", key: "examples", width: 60 },
    ],
    rows,
  });
  return xlsxResponse(bytes, `${template.id}-column-spec`);
}
