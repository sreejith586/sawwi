import { tableWorkbook, xlsxResponse } from "@/lib/excel/sheet";
import { SYNC_FILTERS, SYNC_SEARCH, syncRows } from "@/lib/connectors/rows";
import { applyQuery, queryFromParams } from "@/lib/recon/table";
import { getCurrentSession } from "@/lib/saas/session";

// Excel download of the workspace's import history, filtered and sorted like the screen.
export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return Response.json({ error: "Log in first." }, { status: 401 });
  const rows = applyQuery(await syncRows(session.org.key), queryFromParams(new URL(request.url).searchParams, SYNC_FILTERS), [...SYNC_SEARCH]);
  const bytes = await tableWorkbook({
    sheetName: "Imports",
    columns: [
      { header: "When", key: "at", type: "date" },
      { header: "Connection", key: "connection", width: 40 },
      { header: "Report", key: "report" },
      { header: "From", key: "from", type: "date" },
      { header: "To", key: "to", type: "date" },
      { header: "Rows", key: "rows", type: "number" },
      { header: "Status", key: "status" },
      { header: "Error", key: "error", width: 60 },
      { header: "Run id", key: "runId" },
    ],
    rows,
  });
  return xlsxResponse(bytes, "sawwi-imports");
}
