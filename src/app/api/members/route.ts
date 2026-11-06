import { listMembers } from "@/lib/accounts/members";
import { MEMBER_FILTERS, MEMBER_SEARCH, memberRows } from "@/lib/accounts/rows";
import { tableWorkbook, xlsxResponse } from "@/lib/excel/sheet";
import { labelOf, ROLES } from "@/lib/profile/options";
import { getProfile } from "@/lib/profile/session";
import { applyQuery, queryFromParams } from "@/lib/recon/table";
import { orgKeyFor } from "@/lib/runs/access";

// Excel download of the team list, filtered and sorted like the Accounts table.
export async function GET(request: Request) {
  const profile = await getProfile();
  if (!profile) return Response.json({ error: "Set up your profile first." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const rows = applyQuery(
    memberRows({ roleLabel: labelOf(ROLES, profile.role) }, listMembers(orgKeyFor(profile))),
    queryFromParams(params, MEMBER_FILTERS),
    [...MEMBER_SEARCH],
  );
  const bytes = await tableWorkbook({
    sheetName: "Team",
    columns: [
      { header: "Name", key: "name" },
      { header: "Email", key: "email" },
      { header: "Team", key: "team" },
      { header: "Access", key: "access" },
      { header: "Status", key: "status" },
      { header: "Invited", key: "invited", type: "date" },
    ],
    rows,
  });
  return xlsxResponse(bytes, `${orgKeyFor(profile)}-team`);
}
