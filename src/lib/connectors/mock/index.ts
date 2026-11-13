import { ConnectorError, type ConnectorDeps } from "../types";
import { DEMO_BC_CREDENTIALS, DEMO_BC_STORE_CREDENTIALS, isBusinessCentralUrl, mockBusinessCentral } from "./business-central";
import { DEMO_MAGENTO_CREDENTIALS, isMagentoMockUrl, mockMagento } from "./magento";
import { DEMO_NS_CREDENTIALS, isNetSuiteMockUrl, mockNetSuite } from "./netsuite";
import { DEMO_QBO_CREDENTIALS, isQuickBooksMockUrl, mockQuickBooks } from "./quickbooks";
import { DEMO_XERO_CREDENTIALS, isXeroMockUrl, mockXero } from "./xero";

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
  // The same invented distributor's books in each accounting system (D-85). Listed last, so
  // "Fill with demo data" keeps choosing the sources above when they fit a slot as well.
  { id: "quickbooks", provider: "quickbooks", accountLabel: "Sawwi Demo Distribution LLC (Sandbox)", credentials: DEMO_QBO_CREDENTIALS },
  { id: "xero", provider: "xero", accountLabel: "Sawwi Demo Distribution LLC", credentials: DEMO_XERO_CREDENTIALS },
  { id: "netsuite", provider: "netsuite", accountLabel: "NetSuite 9990001_SB1 (Sandbox)", credentials: DEMO_NS_CREDENTIALS },
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

/** Draft purchase invoices the demo pushed to the mock (D-64), cleared at the nightly reset. */
const bcWrites = new Map<string, Record<string, unknown>[]>();
const bc = mockBusinessCentral({ pageSize: 50, writes: bcWrites });
export const resetDemoErpWrites = () => bcWrites.clear();
const magento = mockMagento();
const quickbooks = mockQuickBooks();
const xero = mockXero();
const netsuite = mockNetSuite();

/** Answers the demo sources' requests in-process; anything else is refused. */
export const demoDeps: ConnectorDeps = {
  fetch: async (url, init) => {
    if (isBusinessCentralUrl(url)) return bc(url, init);
    if (isMagentoMockUrl(url)) return magento(url, init);
    if (isQuickBooksMockUrl(url)) return quickbooks(url, init);
    if (isXeroMockUrl(url)) return xero(url, init);
    if (isNetSuiteMockUrl(url)) return netsuite(url, init);
    throw new ConnectorError("The demo store only reads its own invented data.");
  },
  sleep: async () => {},
};
