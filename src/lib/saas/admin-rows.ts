import { SUBSCRIPTION_LABELS } from "@/lib/stripe/plans";
import { planById } from "./plans";
import type { OrgOverview, UserOverview } from "./store";

// Rows for the admin tables and their Excel exports (pure, no DB).

export type OrgRow = {
  id: string;
  name: string;
  owner: string;
  plan: string;
  planId: string;
  status: string;
  trialEnds: string;
  trialEndsLabel: string;
  trialState: "" | "Active" | "Ended";
  users: number;
  runs: number;
  runsThisMonth: number;
  request: string;
  /** "Stripe · Active", or "Manual" when a superadmin set the plan. */
  billing: string;
  created: string;
};

const dateLabel = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

export function orgRows(orgs: OrgOverview[], now = Date.now()): OrgRow[] {
  return orgs.map((o) => ({
    id: o.id,
    name: o.name,
    owner: o.ownerEmail ?? "",
    plan: planById(o.plan).name,
    planId: o.plan,
    status: o.status === "suspended" ? "Suspended" : "Active",
    trialEnds: o.trialEndsAt,
    trialEndsLabel: dateLabel(o.trialEndsAt),
    trialState: o.plan !== "trial" ? "" : new Date(o.trialEndsAt).getTime() > now ? "Active" : "Ended",
    users: o.users,
    runs: o.runs,
    runsThisMonth: o.runsThisMonth,
    request: o.openRequest ? planById(o.openRequest).name : "",
    billing: o.subscriptionStatus ? `Stripe · ${SUBSCRIPTION_LABELS[o.subscriptionStatus] ?? o.subscriptionStatus}` : o.plan === "trial" ? "" : "Manual",
    created: o.createdAt,
  }));
}

export const ORG_SEARCH = ["name", "owner"] as const;
export const ORG_FILTERS = ["plan", "status", "trialState", "billing"];

export type UserRow = { id: string; name: string; email: string; workspaces: string; access: string; created: string; lastLogin: string };

export function userRows(users: UserOverview[]): UserRow[] {
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    workspaces: u.orgs,
    access: u.access,
    created: u.createdAt,
    lastLogin: u.lastLoginAt ?? "",
  }));
}

export const USER_SEARCH = ["name", "email", "workspaces"] as const;
