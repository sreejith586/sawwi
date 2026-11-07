// The public demo store (D-32): one shared workspace that anyone can open from the login page
// without an account, filled with invented data and wiped every day at 00:00 UTC. Pure and
// client-safe: no database, so any module can ask "is this the demo?".

/**
 * The demo workspace's key. Real keys are made from the company name and only ever contain
 * letters, digits and hyphens (store.uniqueKey), so no real workspace can collide with this one,
 * and the daily reset can never touch customer data.
 */
export const DEMO_ORG_KEY = "_sawwi_demo";
export const DEMO_ORG_NAME = "Sawwi Demo Trading";
/** The shared visitor. `.invalid` can never receive mail, and the password is random and discarded. */
export const DEMO_USER_EMAIL = "visitor@demo.sawwi.invalid";
export const DEMO_USER_NAME = "Demo visitor";

export const isDemoOrg = (orgKey: string | null | undefined): boolean => orgKey === DEMO_ORG_KEY;

const DAY = 86_400_000;
/** The most recent 00:00 UTC at or before `now`: the demo resets on first use after it. */
export const resetBoundary = (now: number): number => Math.floor(now / DAY) * DAY;
export const nextResetAt = (now: number): number => resetBoundary(now) + DAY;
export const needsReset = (lastResetAt: number | undefined, now: number): boolean => lastResetAt === undefined || lastResetAt < resetBoundary(now);

/** "in 5 h 20 min" until the next reset, for the banner. */
export function untilNextReset(now: number): string {
  const mins = Math.max(1, Math.ceil((nextResetAt(now) - now) / 60_000));
  const h = Math.floor(mins / 60);
  return h ? `${h} h ${mins % 60} min` : `${mins} min`;
}
