import { labelOf, ROLES } from "@/lib/profile/options";
import { ACCESS } from "./access";
import type { Member } from "./members";

// Rows for the Accounts table and its Excel export. Pure data (no DB), safe for the client too.

export type MemberRow = {
  id: string;
  name: string;
  email: string;
  access: string;
  accessKey: string;
  team: string;
  status: string;
  statusKey: string;
  invited: string;
  invitedLabel: string;
  owner: boolean;
};

export const MEMBER_STATUS_LABELS = { owner: "Owner", invited: "Invited", active: "Active", deactivated: "Deactivated" } as const;
export const MEMBER_SEARCH = ["name", "email", "team"] as const;
export const MEMBER_FILTERS = ["access", "status"];

const dateLabel = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

export function memberRows(owner: { name: string; email: string; roleLabel: string }, members: Member[]): MemberRow[] {
  return [
    {
      id: "owner",
      name: owner.name,
      email: owner.email,
      access: "Owner",
      accessKey: "owner",
      team: owner.roleLabel,
      status: MEMBER_STATUS_LABELS.active,
      statusKey: "active",
      invited: "",
      invitedLabel: "",
      owner: true,
    },
    ...members.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      access: ACCESS.find((a) => a.value === m.access)?.label ?? m.access,
      accessKey: m.access,
      team: m.team ? labelOf(ROLES, m.team) : "",
      status: MEMBER_STATUS_LABELS[m.status],
      statusKey: m.status,
      invited: m.invitedAt,
      invitedLabel: dateLabel(m.invitedAt),
      owner: false,
    })),
  ];
}
