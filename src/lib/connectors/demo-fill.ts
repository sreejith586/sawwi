import { isDemoOrg } from "@/lib/demo/demo";
import type { RunContext } from "@/lib/runs/engine";
import type { Run } from "@/lib/runs/types";
import { buildRunView } from "@/lib/runs/view";
import { pullIntoRun } from "./service";
import { slotFit } from "./slot-fit";
import { importSources } from "./sources";
import { ConnectorError } from "./types";

// "Fill with demo data" (D-31, D-32): in the demo store only, import into every empty slot of a
// run the built-in demo report that fits it best, for the month the demo data covers.

export const DEMO_WINDOW = { from: "2026-10-01", to: "2026-10-31" };

export type DemoFillResult = { filled: { slot: string; source: string; rows: number }[]; missing: string[] };

export async function fillRunWithDemoData(run: Run, ctx: RunContext): Promise<DemoFillResult> {
  if (!isDemoOrg(run.orgKey)) throw new ConnectorError("Demo data is only available in the demo store.");
  const sources = await importSources(run.orgKey);
  const view = await buildRunView(run.id);
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
    const { rows } = await pullIntoRun(run, slot.key, best.connectionId, best.report, DEMO_WINDOW, ctx);
    result.filled.push({ slot: slot.label, source: best.label, rows });
  }
  return result;
}
