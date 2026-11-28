import { cookies } from "next/headers";
import { checkOAuthState, OAUTH_COOKIE, OAUTH_COOKIE_PATH, redirectUriFor } from "@/lib/connectors/oauth-flow";
import { completeOAuthConnection } from "@/lib/connectors/service";
import { ConnectorError } from "@/lib/connectors/types";
import { listConnections } from "@/lib/connectors/store";
import { blockFor } from "@/lib/saas/limits";
import { canManageTeam, getCurrentSession } from "@/lib/saas/session";

// Where QuickBooks and Xero send the user back (D-81). The state must match this browser's
// cookie and workspace before the code is used; then the connection is tested and saved.
export async function GET(request: Request, ctx: RouteContext<"/api/connections/oauth/[provider]/callback">) {
  const { provider } = await ctx.params;
  const query = new URL(request.url).searchParams;
  const back = new URL("/settings/connections", request.url);
  const session = await getCurrentSession();
  if (!session) return seeOther(new URL("/login", request.url));
  const jar = await cookies();
  const pending = jar.get(OAUTH_COOKIE)?.value;
  jar.delete({ name: OAUTH_COOKIE, path: OAUTH_COOKIE_PATH });
  try {
    if (!canManageTeam(session.access)) throw new ConnectorError("Only workspace owners and admins can add connections.");
    // A new connection counts toward the plan (D-99); signing in again to one already there doesn't.
    if (!(await listConnections(session.org.key)).some((c) => c.provider === provider)) {
      const overPlan = await blockFor(session.org, "connector");
      if (overPlan) throw new ConnectorError(overPlan.message);
    }
    checkOAuthState(pending, provider, session.org.key, query.get("state"));
    const c = await completeOAuthConnection(session.org.key, provider, query, redirectUriFor(provider), session.user.id);
    back.searchParams.set("connected", c.accountLabel);
  } catch (error) {
    back.searchParams.set("error", error instanceof ConnectorError ? error.message : "Couldn't finish connecting. Try again.");
  }
  return seeOther(back);
}

/** A plain 303, so the cookie set above is added to it (Response.redirect's headers are immutable). */
const seeOther = (to: URL | string) => new Response(null, { status: 303, headers: { Location: String(to) } });
