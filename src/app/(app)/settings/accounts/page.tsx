import type { Metadata } from "next";
import { Suspense } from "react";
import { listMembers } from "@/lib/accounts/members";
import { memberRows } from "@/lib/accounts/rows";
import { labelOf, ROLES } from "@/lib/profile/options";
import { canManageTeam, getCurrentSession } from "@/lib/saas/session";
import { orgOwner } from "@/lib/saas/store";
import { MembersPanel } from "./members-panel";

export const metadata: Metadata = { title: "Accounts" };

async function Members() {
  const session = await getCurrentSession();
  if (!session) return null;
  const { org } = session;
  const owner = orgOwner(org.id) ?? session.user;
  const rows = memberRows(
    { name: owner.name, email: owner.email, roleLabel: org.profile ? labelOf(ROLES, org.profile.role) : "" },
    listMembers(org.key),
  );
  return <MembersPanel rows={rows} teams={ROLES.map((r) => ({ value: r.value, label: r.label }))} canManage={canManageTeam(session.access)} />;
}

export default function AccountsPage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading team…</p>}>
      <Members />
    </Suspense>
  );
}
