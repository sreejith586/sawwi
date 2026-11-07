import { DEMO_FILES, demoFileById } from "./mock/demo-files";
import { ConnectorError, type Connector } from "./types";

// "Demo data" (D-31, D-32): a source built into the demo store only. It serves the made-up
// counterpart files in ./mock/demo-files.ts, so a demo run can fill every slot, not only the ones
// Business Central or Magento cover. It needs no credentials, calls nothing, and can't be added
// as a connection to any workspace.

export const DEMO_PROVIDER = "demo-data";

export const demoData: Connector<Record<string, never>> = {
  id: DEMO_PROVIDER,
  label: "Demo data",
  description: "Made-up files for the demo store (marketplace, card gateway, Tabby, courier, warehouse, bank).",
  fields: [],
  reports: DEMO_FILES.map(({ id, label, description, slots }) => ({ id, label, description, slots })),

  parseCredentials() {
    throw new ConnectorError("Demo data is only available in the demo store.");
  },

  async test() {
    throw new ConnectorError("Demo data is only available in the demo store.");
  },

  // Reached only through the demo store's built-in source (service.pullIntoRun checks the workspace).
  async pull(_creds, report, window) {
    const file = demoFileById(report);
    if (!file) throw new ConnectorError(`Unknown demo file: ${report}`);
    const rows = file.dateColumn < 0 ? file.rows : file.rows.filter((r) => r[file.dateColumn] >= window.from && r[file.dateColumn] <= window.to);
    return { headers: [...file.headers], rows: rows.map((r) => [...r]) };
  },
};
