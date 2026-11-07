import { tableWorkbook, xlsxResponse } from "@/lib/excel/sheet";
import { getProfile } from "@/lib/profile/session";
import { applyQuery, queryFromParams } from "@/lib/recon/table";
import { orgKeyFor } from "@/lib/runs/access";
import { listRuns } from "@/lib/runs/store";
import { RUN_FILTERS, RUN_SEARCH } from "@/lib/tables/run-columns";
import { runRows } from "@/lib/tables/run-rows";

// Excel download of the reconciliations list, filtered and sorted like the on-screen table.
export async function GET(request: Request) {
  const profile = await getProfile();
  if (!profile) return Response.json({ error: "Set up your profile first." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const rows = applyQuery(await runRows(await listRuns(orgKeyFor(profile))), queryFromParams(params, RUN_FILTERS), [...RUN_SEARCH]);
  const bytes = await tableWorkbook({
    sheetName: "Reconciliations",
    columns: [
      { header: "Reconciliation", key: "template", width: 40 },
      { header: "Type", key: "group" },
      { header: "Status", key: "status" },
      { header: "Started", key: "started", type: "date" },
      { header: "Files", key: "files", type: "number" },
      { header: "Exceptions", key: "exceptions", type: "number" },
      { header: "Currency", key: "currency" },
      { header: "Value flagged", key: "value", type: "money" },
    ],
    rows,
  });
  return xlsxResponse(bytes, "reconciliations");
}
