import { randomBytes, timingSafeEqual } from "node:crypto";
import { isDemoOrg } from "@/lib/demo/demo";
import { appUrl } from "@/lib/site";
import { connectorsEnabled } from "./crypto";
import { connectorById } from "./registry";
import { ConnectorError } from "./types";

// The browser side of "Connect with …" (D-81). Start: an owner or admin is sent to the provider
// with a random state, which is also kept in a short-lived httpOnly cookie bound to their
// workspace. Callback: the state must match the cookie, and the same workspace must still be
// signed in, before the code is swapped for tokens. The redirect URI is fixed on APP_URL, as
// registered with the provider.

export const OAUTH_COOKIE = "sawwi_oauth";
export const OAUTH_COOKIE_PATH = "/api/connections/oauth";
export const OAUTH_COOKIE_MAX_AGE = 600;

export const redirectUriFor = (provider: string) => `${appUrl()}${OAUTH_COOKIE_PATH}/${provider}/callback`;

type Pending = { provider: string; orgKey: string; state: string };

/** Who may start a connection, and where to send them. Throws ConnectorError with a message for them. */
export function startOAuth(provider: string, orgKey: string, canManage: boolean): { url: string; cookie: string } {
  const connector = connectorById(provider);
  if (!connector?.oauth) throw new ConnectorError("Unknown source.");
  if (!canManage) throw new ConnectorError("Only workspace owners and admins can add connections.");
  if (isDemoOrg(orgKey)) throw new ConnectorError("The live demo uses its built-in sources only.");
  if (!connectorsEnabled()) throw new ConnectorError("Connections aren't switched on for this server yet (SAWWI_CONNECTOR_KEYS).");
  const app = connector.oauth.app();
  if (!app) throw new ConnectorError(`${connector.label} isn't set up on this server yet (${connector.oauth.envVars.join(", ")}).`);
  const state = randomBytes(24).toString("base64url");
  const cookie = Buffer.from(JSON.stringify({ provider, orgKey, state } satisfies Pending)).toString("base64url");
  return { url: connector.oauth.authorizeUrl(app, redirectUriFor(provider), state), cookie };
}

/** Checks the callback belongs to the sign-in this browser started, for this workspace. */
export function checkOAuthState(cookie: string | undefined, provider: string, orgKey: string, state: string | null): void {
  let pending: Partial<Pending> = {};
  try {
    pending = JSON.parse(Buffer.from(cookie ?? "", "base64url").toString("utf8")) as Partial<Pending>;
  } catch {
    // fall through: treated as missing
  }
  const a = Buffer.from(pending.state ?? "");
  const b = Buffer.from(state ?? "");
  const sameState = a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
  if (!sameState || pending.provider !== provider || pending.orgKey !== orgKey) {
    throw new ConnectorError("That sign-in link expired or was started in another browser or workspace. Start again from Settings → Connections.");
  }
}
