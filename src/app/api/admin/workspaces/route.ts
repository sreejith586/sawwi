import { tableWorkbook, xlsxResponse } from "@/lib/excel/sheet";
import { applyQuery, queryFromParams } from "@/lib/recon/table";
import { ORG_FILTERS, ORG_SEARCH, orgRows } from "@/lib/saas/admin-rows";
import { getCurrentSession } from "@/lib/saas/session";
import { listOrgsForAdmin } from "@/lib/saas/store";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.isSuperadmin) return Response.json({ error: "Not found." }, { status: 404 });
  const rows = applyQuery(orgRows(listOrgsForAdmin()), queryFromParams(new URL(request.url).searchParams, ORG_FILTERS), [...ORG_SEARCH]);
  const bytes = await tableWorkbook({
    sheetName: "Workspaces",
    columns: [
      { header: "Workspace", key: "name" },
      { header: "Owner", key: "owner" },
      { header: "Plan", key: "plan" },
      { header: "Trial ends", key: "trialEnds", type: "date" },
      { header: "Trial", key: "trialState" },
      { header: "Billing", key: "billing" },
      { header: "Requested plan", key: "request" },
      { header: "Users", key: "users", type: "number" },
      { header: "Runs this month", key: "runsThisMonth", type: "number" },
      { header: "Runs (all)", key: "runs", type: "number" },
      { header: "Status", key: "status" },
      { header: "Created", key: "created", type: "date" },
    ],
    rows,
  });
  return xlsxResponse(bytes, "sawwi-workspaces");
}
