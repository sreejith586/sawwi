import { DEMO_FILES, demoFileById } from "./mock/demo-files";
import { demoModeOn } from "./mock";
import { ConnectorError, type Connector } from "./types";

// "Demo data" (D-31): a source that only exists in local demo mode (SAWWI_CONNECTOR_MOCK set,
// never in production). It serves the made-up counterpart files in ./mock/demo-files.ts, so a
// demo run can fill every slot, not only the ones Business Central or Magento cover. It needs no
// credentials and calls nothing.

export const DEMO_PROVIDER = "demo-data";

export const demoData: Connector<Record<string, never>> = {
  id: DEMO_PROVIDER,
  label: "Demo data",
  description: "Made-up counterpart files for demos (card gateway, Tabby, courier, warehouse, bank). Only available in demo mode.",
  fields: [],
  reports: DEMO_FILES.map(({ id, label, description, slots }) => ({ id, label, description, slots })),

  parseCredentials() {
    if (!demoModeOn()) throw new ConnectorError("Demo data is only available in demo mode (SAWWI_CONNECTOR_MOCK).");
    return {};
  },

  async test() {
    if (!demoModeOn()) throw new ConnectorError("Demo data is only available in demo mode (SAWWI_CONNECTOR_MOCK).");
    return { accountLabel: "Invented counterpart files" };
  },

  async pull(_creds, report, window) {
    if (!demoModeOn()) throw new ConnectorError("Demo data is only available in demo mode (SAWWI_CONNECTOR_MOCK).");
    const file = demoFileById(report);
    if (!file) throw new ConnectorError(`Unknown demo file: ${report}`);
    const rows = file.dateColumn < 0 ? file.rows : file.rows.filter((r) => r[file.dateColumn] >= window.from && r[file.dateColumn] <= window.to);
    return { headers: [...file.headers], rows: rows.map((r) => [...r]) };
  },
};
