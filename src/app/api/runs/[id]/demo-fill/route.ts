import { fillRunWithDemoData } from "@/lib/connectors/demo-fill";
import { ConnectorError } from "@/lib/connectors/types";
import { isDemoOrg } from "@/lib/demo/demo";
import { getOwnedRun } from "@/lib/runs/access";
import { RunInputError } from "@/lib/runs/engine";
import { buildRunView } from "@/lib/runs/view";
import { runBlocker } from "@/lib/saas/session";

// The demo store only (D-32): fills every empty slot of a run from the built-in demo sources.
// Like any import it is new work on the run, so it goes through runBlocker().
export async function POST(_request: Request, ctx: RouteContext<"/api/runs/[id]/demo-fill">) {
  const { id } = await ctx.params;
  const owned = await getOwnedRun(id);
  if (!owned || !isDemoOrg(owned.run.orgKey)) return Response.json({ error: "Run not found." }, { status: 404 });
  const blocked = await runBlocker();
  if (blocked) return Response.json({ error: blocked.message }, { status: 403 });
  try {
    const result = await fillRunWithDemoData(owned.run, { countries: owned.profile.countries });
    return Response.json({ view: await buildRunView(id), ...result });
  } catch (error) {
    if (error instanceof ConnectorError || error instanceof RunInputError) return Response.json({ error: error.message, view: await buildRunView(id) }, { status: 400 });
    throw error;
  }
}
