import { tableWorkbook, xlsxResponse } from "@/lib/excel/sheet";
import { applyQuery, queryFromParams } from "@/lib/recon/table";
import { getCurrentSession } from "@/lib/saas/session";
import { SCHEDULE_FILTERS, SCHEDULE_SEARCH } from "@/lib/schedules/columns";
import { scheduleRows } from "@/lib/schedules/view";

// Excel download of the workspace's schedules, filtered and sorted like the screen. Read-only.
export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return Response.json({ error: "Log in first." }, { status: 401 });
  const rows = applyQuery(await scheduleRows(session.org.key), queryFromParams(new URL(request.url).searchParams, SCHEDULE_FILTERS), [...SCHEDULE_SEARCH]);
  const bytes = await tableWorkbook({
    sheetName: "Schedules",
    columns: [
      { header: "Reconciliation", key: "template", width: 40 },
      { header: "Type", key: "group" },
      { header: "Repeats", key: "cadence" },
      { header: "Status", key: "status" },
      { header: "Due / next", key: "when", type: "date" },
      { header: "Days overdue", key: "daysLate", type: "number" },
      { header: "Last run", key: "lastRunAt", type: "date" },
      { header: "Runs", key: "runs", type: "number" },
    ],
    rows,
  });
  return xlsxResponse(bytes, "sawwi-schedules");
}
