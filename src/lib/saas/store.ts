import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import type { Profile } from "@/lib/profile/profile";
import type { Access } from "@/lib/accounts/access";
import { countInvited } from "@/lib/accounts/members";
import type { BillingState, OrgStatus, PlanId } from "./plans";

// All SQL for accounts, workspaces (orgs), sessions and platform settings.
// Postgres (D-37); tables are created in src/lib/db.ts.

export type User = { id: string; email: string; name: string; createdAt: string; lastLoginAt?: string };
export type Org = {
  id: string;
  /** Stable key that runs, mappings and members are filed under (never changes on rename). */
  key: string;
  name: string;
  profile?: Profile;
  plan: PlanId;
  status: OrgStatus;
  trialEndsAt: string;
  createdAt: string;
  /** Stripe billing, when the workspace pays by card. */
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionStatus?: string;
  currentPeriodEnd?: string;
};
export type MembershipAccess = "owner" | Access;
export type Membership = { orgId: string; userId: string; access: MembershipAccess };

type Row = Record<string, string | number | null>;

const now = () => new Date().toISOString();
const DAY = 86_400_000;

// ─── Users ───────────────────────────────────────────────────────────────

const toUser = (r: Row): User => ({
  id: String(r.id),
  email: String(r.email),
  name: String(r.name),
  createdAt: String(r.created_at),
  lastLoginAt: r.last_login_at ? String(r.last_login_at) : undefined,
});

export async function findUserByEmail(email: string): Promise<(User & { passwordHash: string }) | undefined> {
  const r = (await getDb().get("SELECT * FROM users WHERE email = ?", email.trim().toLowerCase())) as Row | undefined;
  return r ? { ...toUser(r), passwordHash: String(r.password_hash) } : undefined;
}

export async function getUser(id: string): Promise<User | undefined> {
  const r = (await getDb().get("SELECT * FROM users WHERE id = ?", id)) as Row | undefined;
  return r ? toUser(r) : undefined;
}

export async function createUser(email: string, name: string, passwordHash: string): Promise<User> {
  const user: User = { id: randomUUID(), email: email.trim().toLowerCase(), name: name.trim(), createdAt: now() };
  await getDb().run("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)", user.id, user.email, user.name, passwordHash, user.createdAt);
  return user;
}

export async function touchLogin(userId: string) {
  await getDb().run("UPDATE users SET last_login_at = ? WHERE id = ?", now(), userId);
}

// ─── Orgs (workspaces) ───────────────────────────────────────────────────

const toOrg = (r: Row): Org => ({
  id: String(r.id),
  key: String(r.key),
  name: String(r.name),
  profile: r.profile_json ? (JSON.parse(String(r.profile_json)) as Profile) : undefined,
  plan: r.plan as PlanId,
  status: r.status as OrgStatus,
  trialEndsAt: String(r.trial_ends_at),
  createdAt: String(r.created_at),
  stripeCustomerId: r.stripe_customer_id ? String(r.stripe_customer_id) : undefined,
  stripeSubscriptionId: r.stripe_subscription_id ? String(r.stripe_subscription_id) : undefined,
  subscriptionStatus: r.subscription_status ? String(r.subscription_status) : undefined,
  currentPeriodEnd: r.current_period_end ? String(r.current_period_end) : undefined,
});

async function uniqueKey(name: string): Promise<string> {
  const base = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "workspace";
  for (let i = 1; ; i++) {
    const key = i === 1 ? base : `${base}-${i}`;
    if (!(await getDb().get("SELECT 1 FROM orgs WHERE key = ?", key))) return key;
  }
}

export async function createOrg(name: string, trialDays: number, profile?: Profile): Promise<Org> {
  const org: Org = {
    id: randomUUID(),
    key: await uniqueKey(name),
    name: name.trim(),
    profile,
    plan: "trial",
    status: "active",
    trialEndsAt: new Date(Date.now() + trialDays * DAY).toISOString(),
    createdAt: now(),
  };
  await getDb().run("INSERT INTO orgs (id, key, name, profile_json, plan, status, trial_ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", org.id, org.key, org.name, profile ? JSON.stringify(profile) : null, org.plan, org.status, org.trialEndsAt, org.createdAt);
  return org;
}

/** The demo store's workspace (D-32): a fixed key that await uniqueKey() can never produce. */
export async function createOrgWithKey(key: string, name: string, plan: PlanId, profile: Profile): Promise<Org> {
  const org: Org = { id: randomUUID(), key, name, profile, plan, status: "active", trialEndsAt: new Date(Date.now() + 3650 * DAY).toISOString(), createdAt: now() };
  await getDb().run("INSERT INTO orgs (id, key, name, profile_json, plan, status, trial_ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", org.id, org.key, org.name, JSON.stringify(profile), org.plan, org.status, org.trialEndsAt, org.createdAt);
  return org;
}

export async function getOrg(id: string): Promise<Org | undefined> {
  const r = (await getDb().get("SELECT * FROM orgs WHERE id = ?", id)) as Row | undefined;
  return r ? toOrg(r) : undefined;
}

export async function getOrgByKey(key: string): Promise<Org | undefined> {
  const r = (await getDb().get("SELECT * FROM orgs WHERE key = ?", key)) as Row | undefined;
  return r ? toOrg(r) : undefined;
}

export async function saveOrgProfile(orgId: string, profile: Profile) {
  await getDb().run("UPDATE orgs SET profile_json = ?, name = ? WHERE id = ?", JSON.stringify(profile), profile.company, orgId);
}

export async function setOrgPlan(orgId: string, plan: PlanId) {
  await getDb().run("UPDATE orgs SET plan = ? WHERE id = ?", plan, orgId);
}

export async function setOrgStatus(orgId: string, status: OrgStatus) {
  await getDb().run("UPDATE orgs SET status = ? WHERE id = ?", status, orgId);
}

/** Extends from today or from the current end date, whichever is later. */
export async function extendTrial(orgId: string, days: number) {
  const org = await getOrg(orgId);
  if (!org) return;
  const from = Math.max(Date.now(), new Date(org.trialEndsAt).getTime());
  await getDb().run("UPDATE orgs SET trial_ends_at = ? WHERE id = ?", new Date(from + days * DAY).toISOString(), orgId);
}

export async function runsThisMonth(orgKey: string): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const r = (await getDb().get("SELECT COUNT(*) AS n FROM runs WHERE org_key = ? AND created_at >= ?", orgKey, start.toISOString())) as Row;
  return Number(r.n);
}

export async function memberCount(org: Org): Promise<number> {
  const users = Number(((await getDb().get("SELECT COUNT(*) AS n FROM memberships WHERE org_id = ?", org.id)) as Row).n);
  // Pending invites count toward the seat limit; accepted ones are already memberships.
  return users + (await countInvited(org.key));
}

export async function billingState(org: Org): Promise<BillingState> {
  return { plan: org.plan, status: org.status, trialEndsAt: org.trialEndsAt, runsThisMonth: await runsThisMonth(org.key), members: await memberCount(org) };
}

// ─── Memberships ─────────────────────────────────────────────────────────

export async function addMembership(orgId: string, userId: string, access: MembershipAccess) {
  await getDb().run("INSERT INTO memberships (org_id, user_id, access, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (org_id, user_id) DO UPDATE SET access = excluded.access", orgId, userId, access, now());
}

export async function membershipsForUser(userId: string): Promise<Membership[]> {
  return ((await getDb().all("SELECT * FROM memberships WHERE user_id = ? ORDER BY created_at", userId)) as Row[]).map((r) => ({
    orgId: String(r.org_id),
    userId: String(r.user_id),
    access: r.access as MembershipAccess,
  }));
}

export async function getMembership(orgId: string, userId: string): Promise<Membership | undefined> {
  const r = (await getDb().get("SELECT * FROM memberships WHERE org_id = ? AND user_id = ?", orgId, userId)) as Row | undefined;
  return r ? { orgId, userId, access: r.access as MembershipAccess } : undefined;
}

export async function orgOwner(orgId: string): Promise<User | undefined> {
  const r = (await getDb().get("SELECT u.* FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? AND m.access = 'owner' ORDER BY m.created_at LIMIT 1", orgId)) as Row | undefined;
  return r ? toUser(r) : undefined;
}

// ─── Sessions ────────────────────────────────────────────────────────────

const SESSION_DAYS = 30;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Returns the raw token for the cookie; only its hash is stored. */
export async function createSession(userId: string, orgId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY);
  await getDb().run("INSERT INTO sessions (token_hash, user_id, org_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", hashToken(token), userId, orgId, now(), expiresAt.toISOString());
  return { token, expiresAt };
}

export async function readSession(token: string): Promise<{ userId: string; orgId: string } | undefined> {
  const r = (await getDb().get("SELECT * FROM sessions WHERE token_hash = ?", hashToken(token))) as Row | undefined;
  if (!r) return undefined;
  if (new Date(String(r.expires_at)).getTime() < Date.now()) {
    await deleteSession(token);
    return undefined;
  }
  return { userId: String(r.user_id), orgId: String(r.org_id) };
}

export async function deleteSession(token: string) {
  await getDb().run("DELETE FROM sessions WHERE token_hash = ?", hashToken(token));
}

// ─── Platform settings (superadmin) ──────────────────────────────────────

export type PlatformSettings = { paywallEnabled: boolean; trialDays: number; signupsOpen: boolean };
const DEFAULT_SETTINGS: PlatformSettings = { paywallEnabled: false, trialDays: 14, signupsOpen: true };

export async function getSettings(): Promise<PlatformSettings> {
  const rows = (await getDb().all("SELECT key, value_json FROM platform_settings")) as Row[];
  const stored = Object.fromEntries(rows.map((r) => [String(r.key), JSON.parse(String(r.value_json))]));
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function setSetting<K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]) {
  await getDb().run("INSERT INTO platform_settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json", key, JSON.stringify(value));
}

// ─── Upgrade requests (no payment provider yet: a superadmin applies the plan) ──

export type UpgradeRequest = { id: string; orgId: string; userId: string; plan: PlanId; note?: string; status: "open" | "done" | "declined"; createdAt: string };

export async function createUpgradeRequest(orgId: string, userId: string, plan: PlanId, note?: string): Promise<UpgradeRequest> {
  // One open request per org: a new one replaces the old.
  await getDb().run("UPDATE upgrade_requests SET status = 'declined' WHERE org_id = ? AND status = 'open'", orgId);
  const req: UpgradeRequest = { id: randomUUID(), orgId, userId, plan, note, status: "open", createdAt: now() };
  await getDb().run("INSERT INTO upgrade_requests (id, org_id, user_id, plan, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", req.id, orgId, userId, plan, note ?? null, req.status, req.createdAt);
  return req;
}

const toRequest = (r: Row): UpgradeRequest => ({
  id: String(r.id),
  orgId: String(r.org_id),
  userId: String(r.user_id),
  plan: r.plan as PlanId,
  note: r.note ? String(r.note) : undefined,
  status: r.status as UpgradeRequest["status"],
  createdAt: String(r.created_at),
});

export async function openRequestForOrg(orgId: string): Promise<UpgradeRequest | undefined> {
  const r = (await getDb().get("SELECT * FROM upgrade_requests WHERE org_id = ? AND status = 'open'", orgId)) as Row | undefined;
  return r ? toRequest(r) : undefined;
}

export async function setRequestStatus(id: string, status: UpgradeRequest["status"]) {
  await getDb().run("UPDATE upgrade_requests SET status = ? WHERE id = ?", status, id);
}

export async function getRequest(id: string): Promise<UpgradeRequest | undefined> {
  const r = (await getDb().get("SELECT * FROM upgrade_requests WHERE id = ?", id)) as Row | undefined;
  return r ? toRequest(r) : undefined;
}

// ─── Superadmin listings ─────────────────────────────────────────────────

export type OrgOverview = Org & { ownerEmail?: string; ownerName?: string; users: number; runs: number; runsThisMonth: number; openRequest?: PlanId };

export async function listOrgsForAdmin(): Promise<OrgOverview[]> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const rows = (await getDb().all(`SELECT o.*,
         (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = o.id AND m.access = 'owner' LIMIT 1) AS owner_email,
         (SELECT u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = o.id AND m.access = 'owner' LIMIT 1) AS owner_name,
         (SELECT COUNT(*) FROM memberships m WHERE m.org_id = o.id) AS users,
         (SELECT COUNT(*) FROM runs r WHERE r.org_key = o.key) AS runs,
         (SELECT COUNT(*) FROM runs r WHERE r.org_key = o.key AND r.created_at >= ?) AS runs_month,
         (SELECT q.plan FROM upgrade_requests q WHERE q.org_id = o.id AND q.status = 'open' LIMIT 1) AS open_request
       FROM orgs o ORDER BY o.created_at DESC`, start.toISOString())) as Row[];
  return rows.map((r) => ({
    ...toOrg(r),
    ownerEmail: r.owner_email ? String(r.owner_email) : undefined,
    ownerName: r.owner_name ? String(r.owner_name) : undefined,
    users: Number(r.users),
    runs: Number(r.runs),
    runsThisMonth: Number(r.runs_month),
    openRequest: r.open_request ? (r.open_request as PlanId) : undefined,
  }));
}

export type UserOverview = User & { orgs: string; access: string };

export async function listUsersForAdmin(): Promise<UserOverview[]> {
  const rows = (await getDb().all(`SELECT u.*, string_agg(o.name, ', ') AS org_names, string_agg(m.access, ', ') AS accesses
       FROM users u LEFT JOIN memberships m ON m.user_id = u.id LEFT JOIN orgs o ON o.id = m.org_id
       GROUP BY u.id ORDER BY u.created_at DESC`)) as Row[];
  return rows.map((r) => ({ ...toUser(r), orgs: r.org_names ? String(r.org_names) : "", access: r.accesses ? String(r.accesses) : "" }));
}

export async function removeMembership(orgId: string, userId: string) {
  await getDb().run("DELETE FROM memberships WHERE org_id = ? AND user_id = ?", orgId, userId);
  await getDb().run("DELETE FROM sessions WHERE org_id = ? AND user_id = ?", orgId, userId);
}

export type OpenRequestView = { id: string; orgName: string; requester: string; plan: PlanId; createdAt: string };

export async function listOpenRequests(): Promise<OpenRequestView[]> {
  const rows = (await getDb().all(`SELECT q.id, q.plan, q.created_at, o.name AS org_name, u.email AS requester
       FROM upgrade_requests q JOIN orgs o ON o.id = q.org_id LEFT JOIN users u ON u.id = q.user_id
       WHERE q.status = 'open' ORDER BY q.created_at`)) as Row[];
  return rows.map((r) => ({ id: String(r.id), orgName: String(r.org_name), requester: String(r.requester ?? ""), plan: r.plan as PlanId, createdAt: String(r.created_at) }));
}

// ─── Stripe billing ──────────────────────────────────────────────────────

export async function setStripeCustomer(orgId: string, customerId: string) {
  await getDb().run("UPDATE orgs SET stripe_customer_id = ? WHERE id = ?", customerId, orgId);
}

export async function getOrgByStripeCustomer(customerId: string): Promise<Org | undefined> {
  const r = (await getDb().get("SELECT * FROM orgs WHERE stripe_customer_id = ?", customerId)) as Row | undefined;
  return r ? toOrg(r) : undefined;
}

/** Applies a subscription's state to the workspace (called from checkout return and webhooks). */
export async function applySubscription(
  orgId: string,
  sub: { id: string; status: string; plan: PlanId; currentPeriodEnd?: string },
) {
  await getDb().run("UPDATE orgs SET stripe_subscription_id = ?, subscription_status = ?, current_period_end = ?, plan = ? WHERE id = ?", sub.id, sub.status, sub.currentPeriodEnd ?? null, sub.plan, orgId);
  const open = await openRequestForOrg(orgId);
  if (open && open.plan === sub.plan) await setRequestStatus(open.id, "done");
}
