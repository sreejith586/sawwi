import { businessCentral } from "./business-central";
import { demoData } from "./demo";
import { magento } from "./magento";
import { shopify } from "./shopify";
import { demoModeOn } from "./mock";
import type { Connector } from "./types";

// Every connector Sawwi can use. Add new sources here (D-28).
export const CONNECTORS: Connector[] = [shopify as unknown as Connector, businessCentral as unknown as Connector, magento as unknown as Connector, demoData as unknown as Connector];

/** Connectors offered in Settings: "Demo data" only in demo mode. */
export const availableConnectors = (): Connector[] => CONNECTORS.filter((c) => c.id !== "demo-data" || demoModeOn());

export const connectorById = (id: string): Connector | undefined => CONNECTORS.find((c) => c.id === id);
