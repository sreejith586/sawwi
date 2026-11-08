import { ConnectorError, type ConnectorDeps } from "../types";
import { DEMO_BC_CREDENTIALS, DEMO_BC_STORE_CREDENTIALS, isBusinessCentralUrl, mockBusinessCentral } from "./business-central";
import { DEMO_MAGENTO_CREDENTIALS, isMagentoMockUrl, mockMagento } from "./magento";

// The demo store's built-in sources (D-32). They aren't saved connections: they exist only for
// the demo workspace, hold no secrets, and their requests are answered in-process by the mocks.
// Real workspaces never see them, and nothing here can reach the network.

export type DemoSource = {
  /** Unique among the demo sources; the connection ID is `demo:<id>`. */
  id: string;
  provider: string;
  accountLabel: string;
  credentials: Record<string, string>;
  /** Only these of the connector's reports, when the source is one company of several (D-52). */
  reports?: string[];
};

/** Business Central reports that read the web store's books, served by the store company (D-52). */
export const BC_STORE_REPORTS = ["web_sales_invoices", "web_sales_credit_memos", "items", "web_sales_invoices_fx"];

export const DEMO_SOURCES: DemoSource[] = [
  { id: "business-central", provider: "business-central", accountLabel: "Sawwi Demo Trading LLC (Sandbox)", credentials: DEMO_BC_CREDENTIALS },
  { id: "business-central-store", provider: "business-central", accountLabel: "Sawwi Demo Store LLC (Sandbox)", credentials: DEMO_BC_STORE_CREDENTIALS, reports: BC_STORE_REPORTS },
  { id: "magento", provider: "magento", accountLabel: "Sawwi Demo Store (demo-store.sawwi-mock.example)", credentials: DEMO_MAGENTO_CREDENTIALS },
  { id: "demo-data", provider: "demo-data", accountLabel: "Invented counterpart files", credentials: {} },
];

/** The reports a demo source offers: the store company only its own, the trading company the rest. */
export function demoSourceOffers(source: DemoSource, report: string): boolean {
  if (source.reports) return source.reports.includes(report);
  return !(source.provider === "business-central" && BC_STORE_REPORTS.includes(report));
}

const PREFIX = "demo:";
export const demoConnectionId = (id: string) => `${PREFIX}${id}`;
export const demoSourceFor = (connectionId: string): DemoSource | undefined =>
  connectionId.startsWith(PREFIX) ? DEMO_SOURCES.find((s) => s.id === connectionId.slice(PREFIX.length)) : undefined;

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
