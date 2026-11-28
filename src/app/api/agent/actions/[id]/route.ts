import { decide } from "@/lib/agent/actions";
import { getProfile } from "@/lib/profile/session";
import { getCurrentSession, runBlocker } from "@/lib/saas/session";

/** A push or an AI reading can take a while. */
export const maxDuration = 300;

// The user's answer to an action the chat agent proposed (D-96): confirm runs it under the user's
// own permissions (role, plan, trial: runBlocker), cancel drops it. Only the proposer can decide.
export async function POST(request: Request, ctx: RouteContext<"/api/agent/actions/[id]">) {
  const session = await getCurrentSession();
  if (!session) return Response.json({ error: "Log in again." }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { decision?: unknown };
  const decision = body.decision === "confirm" ? "confirm" : body.decision === "cancel" ? "cancel" : undefined;
  if (!decision) return Response.json({ error: "Confirm or cancel." }, { status: 400 });
  if (decision === "confirm") {
    const blocked = await runBlocker();
    if (blocked) return Response.json({ error: blocked.message }, { status: 403 });
  }
  try {
    const action = await decide(session.org.key, session.user.id, id, decision, { countries: (await getProfile())?.countries });
    return Response.json({ action });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "That didn't work." }, { status: 400 });
  }
}
