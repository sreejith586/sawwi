import { pullIntoRun } from "@/lib/connectors/service";
import { ConnectorError } from "@/lib/connectors/types";
import { getOwnedRun } from "@/lib/runs/access";
import { RunInputError } from "@/lib/runs/engine";
import { buildRunView } from "@/lib/runs/view";
import { runBlocker } from "@/lib/saas/session";

// Pulls a report from a workspace connection into a run slot (D-28). It's new work on a
// run, so it goes through runBlocker() like reconciling does.
export async function POST(request: Request, ctx: RouteContext<"/api/runs/[id]/pull">) {
  const { id } = await ctx.params;
  const owned = await getOwnedRun(id);
  if (!owned) return Response.json({ error: "Run not found." }, { status: 404 });
  const blocked = await runBlocker();
  if (blocked) return Response.json({ error: blocked.message }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
  try {
    const { rows } = await pullIntoRun(owned.run, str("slot"), str("connectionId"), str("report"), { from: str("from"), to: str("to") }, { countries: owned.profile.countries });
    return Response.json({ view: await buildRunView(id), rows });
  } catch (error) {
    if (error instanceof ConnectorError || error instanceof RunInputError) {
      return Response.json({ error: error.message, view: await buildRunView(id) }, { status: 400 });
    }
    throw error;
  }
}
