import { connectorsEnabled } from "@/lib/connectors/crypto";
import { fillRunWithDemoData } from "@/lib/connectors/demo-fill";
import { demoModeOn } from "@/lib/connectors/mock";
import { ConnectorError } from "@/lib/connectors/types";
import { getOwnedRun } from "@/lib/runs/access";
import { RunInputError } from "@/lib/runs/engine";
import { buildRunView } from "@/lib/runs/view";
import { getCurrentSession, runBlocker } from "@/lib/saas/session";

// Local demo mode only (D-31): fills every empty slot of a run from the mocked sources. Like any
// import it is new work on the run, so it goes through runBlocker().
export async function POST(_request: Request, ctx: RouteContext<"/api/runs/[id]/demo-fill">) {
  if (!demoModeOn()) return Response.json({ error: "Not found." }, { status: 404 });
  const { id } = await ctx.params;
  const owned = await getOwnedRun(id);
  if (!owned) return Response.json({ error: "Run not found." }, { status: 404 });
  const blocked = await runBlocker();
  if (blocked) return Response.json({ error: blocked.message }, { status: 403 });
  if (!connectorsEnabled()) return Response.json({ error: "Set SAWWI_CONNECTOR_KEY in .env.local first (see README → Connections)." }, { status: 400 });
  const session = await getCurrentSession();
  try {
    const result = await fillRunWithDemoData(owned.run, { countries: owned.profile.countries }, session?.user.id ?? null);
    return Response.json({ view: buildRunView(id), ...result });
  } catch (error) {
    if (error instanceof ConnectorError || error instanceof RunInputError) return Response.json({ error: error.message, view: buildRunView(id) }, { status: 400 });
    throw error;
  }
}
