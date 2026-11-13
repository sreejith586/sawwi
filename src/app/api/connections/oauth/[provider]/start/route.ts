import { cookies } from "next/headers";
import { OAUTH_COOKIE, OAUTH_COOKIE_MAX_AGE, OAUTH_COOKIE_PATH, startOAuth } from "@/lib/connectors/oauth-flow";
import { ConnectorError } from "@/lib/connectors/types";
import { canManageTeam, getCurrentSession } from "@/lib/saas/session";

// "Connect with QuickBooks / Xero" (D-81): sends an owner or admin to the provider to sign in.
export async function GET(request: Request, ctx: RouteContext<"/api/connections/oauth/[provider]/start">) {
  const { provider } = await ctx.params;
  const back = new URL("/settings/connections", request.url);
  const session = await getCurrentSession();
  if (!session) return seeOther(new URL("/login", request.url));
  try {
    const { url, cookie } = startOAuth(provider, session.org.key, canManageTeam(session.access) && session.org.status !== "suspended");
    (await cookies()).set(OAUTH_COOKIE, cookie, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: OAUTH_COOKIE_PATH, maxAge: OAUTH_COOKIE_MAX_AGE });
    return seeOther(url);
  } catch (error) {
    back.searchParams.set("error", error instanceof ConnectorError ? error.message : "Couldn't start the sign-in.");
    return seeOther(back);
  }
}

/** A plain 303, so the cookie set above is added to it (Response.redirect's headers are immutable). */
const seeOther = (to: URL | string) => new Response(null, { status: 303, headers: { Location: String(to) } });
