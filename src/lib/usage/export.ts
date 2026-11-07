import { tableWorkbook, xlsxResponse } from "@/lib/excel/sheet";
import { applyQuery, queryFromParams } from "@/lib/recon/table";
import { parseRange } from "./aggregate";
import { USAGE_SEARCH, usageFilters } from "./columns";
import { PRICES_AS_OF } from "./pricing";
import { groupUsage, parseView, usageEvents, usageSheetColumns } from "./report";

const SHEET_NAMES = { day: "Usage by day", purpose: "Usage by purpose", model: "Usage by model", run: "Usage by run", workspace: "Usage by workspace" };

/** Excel download of one usage table, filtered and sorted like the screen. */
export async function usageExport(request: Request, orgKey: string | null, fileName: string): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const admin = orgKey === null;
  const view = parseView(params.get("view"), admin);
  const range = parseRange(params.get("range"));
  const rows = applyQuery(groupUsage(await usageEvents(orgKey, range), view), queryFromParams(params, usageFilters(view, admin)), [...USAGE_SEARCH]);
  const bytes = await tableWorkbook({ sheetName: SHEET_NAMES[view], columns: usageSheetColumns(view, admin), rows });
  return xlsxResponse(bytes, `${fileName}-${view}-${range === "all" ? "all-time" : `${range}d`}-prices-${PRICES_AS_OF}`);
}
