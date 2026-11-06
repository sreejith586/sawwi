import type { Metadata } from "next";
import { Suspense } from "react";
import { listMembers } from "@/lib/accounts/members";
import { memberRows } from "@/lib/accounts/rows";
import { labelOf, ROLES } from "@/lib/profile/options";
import { getProfile } from "@/lib/profile/session";
import { orgKeyFor } from "@/lib/runs/access";
import { MembersPanel } from "./members-panel";

export const metadata: Metadata = { title: "Accounts" };

async function Members() {
  const profile = await getProfile();
  if (!profile) return null;
  const rows = memberRows({ roleLabel: labelOf(ROLES, profile.role) }, listMembers(orgKeyFor(profile)));
  return <MembersPanel rows={rows} teams={ROLES.map((r) => ({ value: r.value, label: r.label }))} />;
}

export default function AccountsPage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading team…</p>}>
      <Members />
    </Suspense>
  );
}
