import { ConnectorError, type ConnectorDeps } from "../types";
import { DEMO_BC_CREDENTIALS, isBusinessCentralUrl, mockBusinessCentral } from "./business-central";
import { DEMO_MAGENTO_CREDENTIALS, isMagentoMockUrl, mockMagento } from "./magento";

// The demo store's built-in sources (D-32). They aren't saved connections: they exist only for
// the demo workspace, hold no secrets, and their requests are answered in-process by the mocks.
// Real workspaces never see them, and nothing here can reach the network.

export type DemoSource = { provider: string; accountLabel: string; credentials: Record<string, string> };

export const DEMO_SOURCES: DemoSource[] = [
  { provider: "business-central", accountLabel: "Sawwi Demo Trading LLC (Sandbox)", credentials: DEMO_BC_CREDENTIALS },
  { provider: "magento", accountLabel: "Sawwi Demo Store (demo-store.sawwi-mock.example)", credentials: DEMO_MAGENTO_CREDENTIALS },
  { provider: "demo-data", accountLabel: "Invented counterpart files", credentials: {} },
];

const PREFIX = "demo:";
export const demoConnectionId = (provider: string) => `${PREFIX}${provider}`;
export const demoSourceFor = (connectionId: string): DemoSource | undefined =>
  connectionId.startsWith(PREFIX) ? DEMO_SOURCES.find((s) => s.provider === connectionId.slice(PREFIX.length)) : undefined;

const bc = mockBusinessCentral({ pageSize: 50 });
const magento = mockMagento();

/** Answers the demo sources' requests in-process; anything else is refused. */
export const demoDeps: ConnectorDeps = {
  fetch: async (url, init) => {
    if (isBusinessCentralUrl(url)) return bc(url, init);
    if (isMagentoMockUrl(url)) return magento(url, init);
    throw new ConnectorError("The demo store only reads its own invented data.");
  },
  sleep: async () => {},
};
