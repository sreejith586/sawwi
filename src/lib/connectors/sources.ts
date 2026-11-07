import { availableConnectors } from "./registry";
import { listConnections } from "./store";

/** What the run page needs to offer "Import from a connection": no secrets. */
export type ImportSource = {
  connectionId: string;
  label: string;
  provider: string;
  status: string;
  reports: { id: string; label: string; slots: string[] }[];
};

export function importSources(orgKey: string): ImportSource[] {
  return listConnections(orgKey).flatMap((c) => {
    const connector = availableConnectors().find((x) => x.id === c.provider);
    if (!connector) return []; // unknown, or "Demo data" outside demo mode
    return [{ connectionId: c.id, label: `${connector.label}: ${c.accountLabel}`, provider: c.provider, status: c.status, reports: connector.reports.map(({ id, label, slots }) => ({ id, label, slots })) }];
  });
}
