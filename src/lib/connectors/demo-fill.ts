import type { RunContext } from "@/lib/runs/engine";
import type { Run } from "@/lib/runs/types";
import { buildRunView } from "@/lib/runs/view";
import { DEMO_PROVIDER } from "./demo";
import { activeMocks, demoModeOn } from "./mock";
import { addConnection, liveDeps, pullIntoRun } from "./service";
import { slotFit } from "./slot-fit";
import { importSources } from "./sources";
import { listConnections } from "./store";
import { ConnectorError, type ConnectorDeps } from "./types";

// "Fill with demo data" (D-31): in local demo mode, connect the mocked sources if needed and
// import, into every empty slot of a run, the demo report that fits it best, for the month the
// demo data covers. Only mocked or demo sources are used, never a real connection.

export const DEMO_WINDOW = { from: "2026-10-01", to: "2026-10-31" };

export type DemoFillResult = { filled: { slot: string; source: string; rows: number }[]; missing: string[] };

export async function fillRunWithDemoData(run: Run, ctx: RunContext, createdBy: string | null, deps: ConnectorDeps = liveDeps): Promise<DemoFillResult> {
  if (!demoModeOn()) throw new ConnectorError("Demo data is only available in demo mode.");
  const providers = [...activeMocks().map((m) => ({ id: m.id, values: m.demoValues })), { id: DEMO_PROVIDER, values: {} }];
  const existing = new Set(listConnections(run.orgKey).map((c) => c.provider));
  for (const p of providers) if (!existing.has(p.id)) await addConnection(run.orgKey, p.id, p.values, createdBy, deps);

  const allowed = new Set(providers.map((p) => p.id));
  const sources = importSources(run.orgKey).filter((s) => allowed.has(s.provider));
  const view = buildRunView(run.id);
  if (!view) throw new ConnectorError("Run not found.");

  const result: DemoFillResult = { filled: [], missing: [] };
  for (const slot of view.slots.filter((s) => !s.file)) {
    let best: { connectionId: string; report: string; label: string; fit: number } | undefined;
    for (const s of sources) {
      for (const r of s.reports) {
        const fit = slotFit(r.slots, view.templateId, slot.key);
        if (fit > 0 && (!best || fit > best.fit)) best = { connectionId: s.connectionId, report: r.id, label: `${s.label} · ${r.label}`, fit };
      }
    }
    if (!best) {
      result.missing.push(slot.label);
      continue;
    }
    const { rows } = await pullIntoRun(run, slot.key, best.connectionId, best.report, DEMO_WINDOW, ctx, deps);
    result.filled.push({ slot: slot.label, source: best.label, rows });
  }
  return result;
}
