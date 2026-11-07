import { businessCentral } from "./business-central";
import { magento } from "./magento";
import { shopify } from "./shopify";
import type { Connector } from "./types";

// Every connector Sawwi can use. Add new sources here (D-28).
export const CONNECTORS: Connector[] = [shopify as unknown as Connector, businessCentral as unknown as Connector, magento as unknown as Connector];

export const connectorById = (id: string): Connector | undefined => CONNECTORS.find((c) => c.id === id);
