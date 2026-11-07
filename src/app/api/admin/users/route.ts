import { tableWorkbook, xlsxResponse } from "@/lib/excel/sheet";
import { applyQuery, queryFromParams } from "@/lib/recon/table";
import { USER_SEARCH, userRows } from "@/lib/saas/admin-rows";
import { getCurrentSession } from "@/lib/saas/session";
import { listUsersForAdmin } from "@/lib/saas/store";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.isSuperadmin) return Response.json({ error: "Not found." }, { status: 404 });
  const rows = applyQuery(userRows(await listUsersForAdmin()), queryFromParams(new URL(request.url).searchParams, []), [...USER_SEARCH]);
  const bytes = await tableWorkbook({
    sheetName: "Users",
    columns: [
      { header: "Name", key: "name" },
      { header: "Email", key: "email" },
      { header: "Workspaces", key: "workspaces" },
      { header: "Access", key: "access" },
      { header: "Signed up", key: "created", type: "date" },
      { header: "Last login", key: "lastLogin", type: "date" },
    ],
    rows,
  });
  return xlsxResponse(bytes, "sawwi-users");
}
