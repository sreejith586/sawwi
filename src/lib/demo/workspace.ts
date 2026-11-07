import { randomBytes } from "node:crypto";
import type { Profile } from "@/lib/profile/profile";
import { hashPassword } from "@/lib/saas/password";
import * as saas from "@/lib/saas/store";
import { DEMO_ORG_KEY, DEMO_ORG_NAME, DEMO_USER_EMAIL, DEMO_USER_NAME, needsReset } from "./demo";
import { getDemoState, setDemoState, wipeOrgData } from "./store";

// Creates the demo store on first use and resets it once a day (D-32). The reset runs on the first
// request after 00:00 UTC, like scheduled runs' due dates (D-26): no job runner needed.

/** Every channel, so every template in the gallery applies to the demo. */
const DEMO_PROFILE: Profile = {
  company: DEMO_ORG_NAME,
  role: "finance",
  countries: ["AE"],
  accountingSystems: ["dynamics"],
  channels: ["marketplace", "webstore", "b2b"],
  marketplaces: ["amazon_ae", "noon"],
  sellsB2B: true,
  usesMarketplaceFulfilment: true,
  platforms: ["magento2"],
  payments: ["gateway", "cod", "bnpl"],
  b2bPayments: ["bank_transfer", "cheque"],
  givesCreditTerms: true,
  buysFromSuppliers: true,
  importsStock: true,
};

export type DemoWorkspace = { org: saas.Org; user: saas.User };

export async function ensureDemoWorkspace(): Promise<DemoWorkspace> {
  const org = saas.getOrgByKey(DEMO_ORG_KEY) ?? saas.createOrgWithKey(DEMO_ORG_KEY, DEMO_ORG_NAME, "enterprise", DEMO_PROFILE);
  let user: saas.User | undefined = saas.findUserByEmail(DEMO_USER_EMAIL);
  // Nobody can log in as the visitor: the password is random and never stored anywhere else.
  user ??= saas.createUser(DEMO_USER_EMAIL, DEMO_USER_NAME, await hashPassword(randomBytes(32).toString("base64url")));
  // Editor: can run reconciliations, can't manage the team, plan or profile.
  if (!saas.getMembership(org.id, user.id)) saas.addMembership(org.id, user.id, "editor");
  return { org, user: saas.getUser(user.id)! };
}

const RESET_KEY = "last_reset_at";

/** Wipes the demo's runs, imports, schedules and saved mappings if it hasn't been reset since 00:00 UTC. */
export function resetDemoIfDue(now = Date.now()): boolean {
  const last = getDemoState(RESET_KEY);
  if (!needsReset(last ? Date.parse(last) : undefined, now)) return false;
  wipeOrgData(DEMO_ORG_KEY);
  setDemoState(RESET_KEY, new Date(now).toISOString());
  return true;
}

export const lastDemoReset = (): string | undefined => getDemoState(RESET_KEY);
