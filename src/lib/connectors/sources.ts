import { isDemoOrg } from "@/lib/demo/demo";
import { DEMO_SOURCES, demoConnectionId } from "./mock";
import { availableConnectors, connectorById } from "./registry";
import { listConnections } from "./store";

/** What the run page needs to offer "Import from a connection": no secrets. */
export type ImportSource = {
  connectionId: string;
  label: string;
  provider: string;
  status: string;
  reports: { id: string; label: string; slots: string[] }[];
};

const reportsOf = (id: string) => connectorById(id)?.reports.map(({ id, label, slots }) => ({ id, label, slots })) ?? [];

/** The demo store has only its built-in sources (D-32); real workspaces only their own connections. */
export function importSources(orgKey: string): ImportSource[] {
  if (isDemoOrg(orgKey)) {
    return DEMO_SOURCES.map((d) => ({ connectionId: demoConnectionId(d.provider), label: `${connectorById(d.provider)!.label}: ${d.accountLabel}`, provider: d.provider, status: "connected", reports: reportsOf(d.provider) }));
  }
  return listConnections(orgKey).flatMap((c) => {
    const connector = availableConnectors().find((x) => x.id === c.provider);
    if (!connector) return [];
    return [{ connectionId: c.id, label: `${connector.label}: ${c.accountLabel}`, provider: c.provider, status: c.status, reports: connector.reports.map(({ id, label, slots }) => ({ id, label, slots })) }];
  });
}
