import { ConnectorError, type ConnectorDeps, type OAuthApp } from "./types";

// OAuth 2.0 authorization-code helpers shared by QuickBooks Online and Xero (D-81).
//
// Both providers sign the user in on their own site and send them back with a code. Sawwi swaps
// the code for an access token (short-lived: 1 hour at Intuit, 30 minutes at Xero) and a refresh
// token, which rotates: each refresh may return a new one, and the old one stops working. So the
// connection keeps the newest tokens, encrypted like any other secret, and saves them back
// through deps.saveCredentials whenever they change. The access token and its expiry are stored
// too, so most calls don't need a refresh at all.

/** Stored for every OAuth connection, next to the provider's own fields (realm, tenant…). */
export type OAuthTokens = { accessToken: string; refreshToken: string; /** Epoch ms. */ expiresAt: string };

const MAX_ATTEMPTS = 5;
/** Refresh this long before the access token runs out. */
const EARLY_MS = 2 * 60_000;

export function appFromEnv(idVar: string, secretVar: string): OAuthApp | null {
  const clientId = (process.env[idVar] ?? "").trim();
  const clientSecret = (process.env[secretVar] ?? "").trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

const basic = (app: OAuthApp) => `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64")}`;

type TokenReply = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };

/** POSTs a form to a token endpoint with the app's keys as HTTP Basic auth. */
export async function tokenRequest(tokenUrl: string, app: OAuthApp, form: Record<string, string>, deps: ConnectorDeps, provider: string): Promise<OAuthTokens> {
  const body = new URLSearchParams(form).toString();
  for (let attempt = 1; ; attempt++) {
    const res = await deps.fetch(tokenUrl, { method: "POST", headers: { Authorization: basic(app), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body });
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
      await deps.sleep(1000 * attempt);
      continue;
    }
    const json = (await res.json().catch(() => ({}))) as TokenReply;
    if (res.ok && json.access_token && json.refresh_token) {
      return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: String(Date.now() + Number(json.expires_in ?? 1800) * 1000) };
    }
    if (json.error === "invalid_grant") throw new ConnectorError(`${provider} sign-in has expired or was revoked. Remove this connection and connect again.`);
    if (json.error === "invalid_client" || json.error === "unauthorized_client") throw new ConnectorError(`${provider} didn't accept Sawwi's app keys. The server's ${provider} app settings need checking.`);
    throw new ConnectorError(`${provider} sign-in failed (HTTP ${res.status}${json.error ? `: ${json.error}` : ""}).`);
  }
}

/**
 * A valid access token for these credentials: the stored one while it lasts, else a refreshed
 * one, saved back with the (possibly rotated) refresh token.
 */
export async function accessTokenFor<C extends OAuthTokens & Record<string, string>>(
  creds: C,
  app: OAuthApp | null,
  tokenUrl: string,
  deps: ConnectorDeps,
  provider: string,
  now = Date.now(),
): Promise<string> {
  if (creds.accessToken && Number(creds.expiresAt) - EARLY_MS > now) return creds.accessToken;
  if (!app) throw new ConnectorError(`${provider} isn't set up on this server, so Sawwi can't renew the sign-in.`);
  const tokens = await tokenRequest(tokenUrl, app, { grant_type: "refresh_token", refresh_token: creds.refreshToken }, deps, provider);
  Object.assign(creds, tokens); // later calls with the same object reuse the new token
  await deps.saveCredentials?.({ ...creds });
  return tokens.accessToken;
}

/** Checks the stored token fields exist; for parseCredentials of OAuth connectors. */
export function parseTokens(input: Record<string, string>, provider: string): OAuthTokens {
  const accessToken = (input.accessToken ?? "").trim();
  const refreshToken = (input.refreshToken ?? "").trim();
  if (!refreshToken) throw new ConnectorError(`Connect ${provider} with the “Connect with ${provider}” button.`);
  return { accessToken, refreshToken, expiresAt: String(Number(input.expiresAt) || 0) };
}

/** The payload of a JWT, unverified: only for reading claims the provider gave us directly. */
export function jwtClaims(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}
