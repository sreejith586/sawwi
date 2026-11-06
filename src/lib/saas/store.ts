import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import type { Profile } from "@/lib/profile/profile";
import type { Access } from "@/lib/accounts/access";
import { countInvited } from "@/lib/accounts/members";
import type { BillingState, OrgStatus, PlanId } from "./plans";

// All SQL for accounts, workspaces (orgs), sessions and platform settings.
// SQLite for now; like src/lib/runs/store.ts, this file is the only thing to port to Postgres.

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
};
export type MembershipAccess = "owner" | Access;
export type Membership = { orgId: string; userId: string; access: MembershipAccess };

type Row = Record<string, string | number | null>;

let ready = false;
function db() {
  const d = getDb();
  if (!ready) {
    d.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_login_at TEXT
      );
      CREATE TABLE IF NOT EXISTS orgs (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        profile_json TEXT,
        plan TEXT NOT NULL,
        status TEXT NOT NULL,
        trial_ends_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memberships (
        org_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        access TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (org_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        org_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS platform_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS upgrade_requests (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        plan TEXT NOT NULL,
        note TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    ready = true;
  }
  return d;
}

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

export function findUserByEmail(email: string): (User & { passwordHash: string }) | undefined {
  const r = db().prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase()) as Row | undefined;
  return r ? { ...toUser(r), passwordHash: String(r.password_hash) } : undefined;
}

export function getUser(id: string): User | undefined {
  const r = db().prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined;
  return r ? toUser(r) : undefined;
}

export function createUser(email: string, name: string, passwordHash: string): User {
  const user: User = { id: randomUUID(), email: email.trim().toLowerCase(), name: name.trim(), createdAt: now() };
  db().prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(user.id, user.email, user.name, passwordHash, user.createdAt);
  return user;
}

export function touchLogin(userId: string) {
  db().prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now(), userId);
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
});

function uniqueKey(name: string): string {
  const base = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "workspace";
  for (let i = 1; ; i++) {
    const key = i === 1 ? base : `${base}-${i}`;
    if (!db().prepare("SELECT 1 FROM orgs WHERE key = ?").get(key)) return key;
  }
}

export function createOrg(name: string, trialDays: number, profile?: Profile): Org {
  const org: Org = {
    id: randomUUID(),
    key: uniqueKey(name),
    name: name.trim(),
    profile,
    plan: "trial",
    status: "active",
    trialEndsAt: new Date(Date.now() + trialDays * DAY).toISOString(),
    createdAt: now(),
  };
  db()
    .prepare("INSERT INTO orgs (id, key, name, profile_json, plan, status, trial_ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(org.id, org.key, org.name, profile ? JSON.stringify(profile) : null, org.plan, org.status, org.trialEndsAt, org.createdAt);
  return org;
}

export function getOrg(id: string): Org | undefined {
  const r = db().prepare("SELECT * FROM orgs WHERE id = ?").get(id) as Row | undefined;
  return r ? toOrg(r) : undefined;
}

export function getOrgByKey(key: string): Org | undefined {
  const r = db().prepare("SELECT * FROM orgs WHERE key = ?").get(key) as Row | undefined;
  return r ? toOrg(r) : undefined;
}

export function saveOrgProfile(orgId: string, profile: Profile) {
  db().prepare("UPDATE orgs SET profile_json = ?, name = ? WHERE id = ?").run(JSON.stringify(profile), profile.company, orgId);
}

export function setOrgPlan(orgId: string, plan: PlanId) {
  db().prepare("UPDATE orgs SET plan = ? WHERE id = ?").run(plan, orgId);
}

export function setOrgStatus(orgId: string, status: OrgStatus) {
  db().prepare("UPDATE orgs SET status = ? WHERE id = ?").run(status, orgId);
}

/** Extends from today or from the current end date, whichever is later. */
export function extendTrial(orgId: string, days: number) {
  const org = getOrg(orgId);
  if (!org) return;
  const from = Math.max(Date.now(), new Date(org.trialEndsAt).getTime());
  db().prepare("UPDATE orgs SET trial_ends_at = ? WHERE id = ?").run(new Date(from + days * DAY).toISOString(), orgId);
}

export function runsThisMonth(orgKey: string): number {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const r = db().prepare("SELECT COUNT(*) AS n FROM runs WHERE org_key = ? AND created_at >= ?").get(orgKey, start.toISOString()) as Row;
  return Number(r.n);
}

export function memberCount(org: Org): number {
  const users = Number((db().prepare("SELECT COUNT(*) AS n FROM memberships WHERE org_id = ?").get(org.id) as Row).n);
  // Pending invites count toward the seat limit; accepted ones are already memberships.
  return users + countInvited(org.key);
}

export function billingState(org: Org): BillingState {
  return { plan: org.plan, status: org.status, trialEndsAt: org.trialEndsAt, runsThisMonth: runsThisMonth(org.key), members: memberCount(org) };
}

// ─── Memberships ─────────────────────────────────────────────────────────

export function addMembership(orgId: string, userId: string, access: MembershipAccess) {
  db()
    .prepare("INSERT INTO memberships (org_id, user_id, access, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (org_id, user_id) DO UPDATE SET access = excluded.access")
    .run(orgId, userId, access, now());
}

export function membershipsForUser(userId: string): Membership[] {
  return (db().prepare("SELECT * FROM memberships WHERE user_id = ? ORDER BY created_at").all(userId) as Row[]).map((r) => ({
    orgId: String(r.org_id),
    userId: String(r.user_id),
    access: r.access as MembershipAccess,
  }));
}

export function getMembership(orgId: string, userId: string): Membership | undefined {
  const r = db().prepare("SELECT * FROM memberships WHERE org_id = ? AND user_id = ?").get(orgId, userId) as Row | undefined;
  return r ? { orgId, userId, access: r.access as MembershipAccess } : undefined;
}

export function orgOwner(orgId: string): User | undefined {
  const r = db()
    .prepare("SELECT u.* FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? AND m.access = 'owner' ORDER BY m.created_at LIMIT 1")
    .get(orgId) as Row | undefined;
  return r ? toUser(r) : undefined;
}

// ─── Sessions ────────────────────────────────────────────────────────────

const SESSION_DAYS = 30;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Returns the raw token for the cookie; only its hash is stored. */
export function createSession(userId: string, orgId: string): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY);
  db().prepare("INSERT INTO sessions (token_hash, user_id, org_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").run(hashToken(token), userId, orgId, now(), expiresAt.toISOString());
  return { token, expiresAt };
}

export function readSession(token: string): { userId: string; orgId: string } | undefined {
  const r = db().prepare("SELECT * FROM sessions WHERE token_hash = ?").get(hashToken(token)) as Row | undefined;
  if (!r) return undefined;
  if (new Date(String(r.expires_at)).getTime() < Date.now()) {
    deleteSession(token);
    return undefined;
  }
  return { userId: String(r.user_id), orgId: String(r.org_id) };
}

export function deleteSession(token: string) {
  db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

// ─── Platform settings (superadmin) ──────────────────────────────────────

export type PlatformSettings = { paywallEnabled: boolean; trialDays: number; signupsOpen: boolean };
const DEFAULT_SETTINGS: PlatformSettings = { paywallEnabled: false, trialDays: 14, signupsOpen: true };

export function getSettings(): PlatformSettings {
  const rows = db().prepare("SELECT key, value_json FROM platform_settings").all() as Row[];
  const stored = Object.fromEntries(rows.map((r) => [String(r.key), JSON.parse(String(r.value_json))]));
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function setSetting<K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]) {
  db()
    .prepare("INSERT INTO platform_settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json")
    .run(key, JSON.stringify(value));
}

// ─── Upgrade requests (no payment provider yet: a superadmin applies the plan) ──

export type UpgradeRequest = { id: string; orgId: string; userId: string; plan: PlanId; note?: string; status: "open" | "done" | "declined"; createdAt: string };

export function createUpgradeRequest(orgId: string, userId: string, plan: PlanId, note?: string): UpgradeRequest {
  // One open request per org: a new one replaces the old.
  db().prepare("UPDATE upgrade_requests SET status = 'declined' WHERE org_id = ? AND status = 'open'").run(orgId);
  const req: UpgradeRequest = { id: randomUUID(), orgId, userId, plan, note, status: "open", createdAt: now() };
  db()
    .prepare("INSERT INTO upgrade_requests (id, org_id, user_id, plan, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(req.id, orgId, userId, plan, note ?? null, req.status, req.createdAt);
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

export function openRequestForOrg(orgId: string): UpgradeRequest | undefined {
  const r = db().prepare("SELECT * FROM upgrade_requests WHERE org_id = ? AND status = 'open'").get(orgId) as Row | undefined;
  return r ? toRequest(r) : undefined;
}

export function setRequestStatus(id: string, status: UpgradeRequest["status"]) {
  db().prepare("UPDATE upgrade_requests SET status = ? WHERE id = ?").run(status, id);
}

export function getRequest(id: string): UpgradeRequest | undefined {
  const r = db().prepare("SELECT * FROM upgrade_requests WHERE id = ?").get(id) as Row | undefined;
  return r ? toRequest(r) : undefined;
}

// ─── Superadmin listings ─────────────────────────────────────────────────

export type OrgOverview = Org & { ownerEmail?: string; ownerName?: string; users: number; runs: number; runsThisMonth: number; openRequest?: PlanId };

export function listOrgsForAdmin(): OrgOverview[] {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const rows = db()
    .prepare(
      `SELECT o.*,
         (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = o.id AND m.access = 'owner' LIMIT 1) AS owner_email,
         (SELECT u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = o.id AND m.access = 'owner' LIMIT 1) AS owner_name,
         (SELECT COUNT(*) FROM memberships m WHERE m.org_id = o.id) AS users,
         (SELECT COUNT(*) FROM runs r WHERE r.org_key = o.key) AS runs,
         (SELECT COUNT(*) FROM runs r WHERE r.org_key = o.key AND r.created_at >= ?) AS runs_month,
         (SELECT q.plan FROM upgrade_requests q WHERE q.org_id = o.id AND q.status = 'open' LIMIT 1) AS open_request
       FROM orgs o ORDER BY o.created_at DESC`,
    )
    .all(start.toISOString()) as Row[];
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

export function listUsersForAdmin(): UserOverview[] {
  const rows = db()
    .prepare(
      `SELECT u.*, GROUP_CONCAT(o.name, ', ') AS org_names, GROUP_CONCAT(m.access, ', ') AS accesses
       FROM users u LEFT JOIN memberships m ON m.user_id = u.id LEFT JOIN orgs o ON o.id = m.org_id
       GROUP BY u.id ORDER BY u.created_at DESC`,
    )
    .all() as Row[];
  return rows.map((r) => ({ ...toUser(r), orgs: r.org_names ? String(r.org_names) : "", access: r.accesses ? String(r.accesses) : "" }));
}

export function removeMembership(orgId: string, userId: string) {
  db().prepare("DELETE FROM memberships WHERE org_id = ? AND user_id = ?").run(orgId, userId);
  db().prepare("DELETE FROM sessions WHERE org_id = ? AND user_id = ?").run(orgId, userId);
}

export type OpenRequestView = { id: string; orgName: string; requester: string; plan: PlanId; createdAt: string };

export function listOpenRequests(): OpenRequestView[] {
  const rows = db()
    .prepare(
      `SELECT q.id, q.plan, q.created_at, o.name AS org_name, u.email AS requester
       FROM upgrade_requests q JOIN orgs o ON o.id = q.org_id LEFT JOIN users u ON u.id = q.user_id
       WHERE q.status = 'open' ORDER BY q.created_at`,
    )
    .all() as Row[];
  return rows.map((r) => ({ id: String(r.id), orgName: String(r.org_name), requester: String(r.requester ?? ""), plan: r.plan as PlanId, createdAt: String(r.created_at) }));
}
