import { businessCentral } from "./business-central";
import { demoData } from "./demo";
import { magento } from "./magento";
import { netsuite } from "./netsuite";
import { quickbooks } from "./quickbooks";
import { xero } from "./xero";
import { shopify } from "./shopify";
import type { Connector } from "./types";

// Every connector Sawwi can use. Add new sources here (D-28).
export const CONNECTORS: Connector[] = [
  shopify as unknown as Connector, businessCentral as unknown as Connector, magento as unknown as Connector,
  quickbooks as unknown as Connector,
  xero as unknown as Connector,
  netsuite as unknown as Connector,
  demoData as unknown as Connector,
];

/** Connectors a workspace can add. "Demo data" is built into the demo store only (D-32). */
export const availableConnectors = (): Connector[] => CONNECTORS.filter((c) => c.id !== "demo-data");

export const connectorById = (id: string): Connector | undefined => CONNECTORS.find((c) => c.id === id);
