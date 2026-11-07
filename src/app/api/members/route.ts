import { listMembers } from "@/lib/accounts/members";
import { MEMBER_FILTERS, MEMBER_SEARCH, memberRows } from "@/lib/accounts/rows";
import { tableWorkbook, xlsxResponse } from "@/lib/excel/sheet";
import { labelOf, ROLES } from "@/lib/profile/options";
import { getCurrentSession } from "@/lib/saas/session";
import { orgOwner } from "@/lib/saas/store";
import { applyQuery, queryFromParams } from "@/lib/recon/table";

// Excel download of the team list, filtered and sorted like the Accounts table.
export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return Response.json({ error: "Log in first." }, { status: 401 });
  const { org } = session;
  const owner = await orgOwner(org.id) ?? session.user;
  const params = new URL(request.url).searchParams;
  const rows = applyQuery(
    memberRows({ name: owner.name, email: owner.email, roleLabel: org.profile ? labelOf(ROLES, org.profile.role) : "" }, await listMembers(org.key)),
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
  return xlsxResponse(bytes, `${org.key}-team`);
}
