import type { FetchLike } from "../types";
import { DEMO_BC_CREDENTIALS, isBusinessCentralUrl, mockBusinessCentral } from "./business-central";
import { DEMO_MAGENTO_CREDENTIALS, isMagentoMockUrl, mockMagento } from "./magento";

// Local demo mode (D-29, D-30): with SAWWI_CONNECTOR_MOCK=business-central,magento (or "all"),
// requests to those providers are answered in-process by invented data instead of the real service.
// Never in production: there the variable is ignored.

type Mock = { id: string; matches: (url: string) => boolean; fetch: FetchLike; demoValues: Record<string, string> };

const MOCKS: Mock[] = [
  { id: "business-central", matches: isBusinessCentralUrl, fetch: mockBusinessCentral({ pageSize: 50 }), demoValues: DEMO_BC_CREDENTIALS },
  // The demo store sits at a reserved .example address, so nothing real is ever shadowed.
  { id: "magento", matches: isMagentoMockUrl, fetch: mockMagento(), demoValues: DEMO_MAGENTO_CREDENTIALS },
];

/** Local demo mode: SAWWI_CONNECTOR_MOCK is set to anything, outside production. */
export const demoModeOn = () => process.env.NODE_ENV !== "production" && (process.env.SAWWI_CONNECTOR_MOCK ?? "").trim() !== "";

export function activeMocks(): Mock[] {
  if (!demoModeOn()) return [];
  const wanted = (process.env.SAWWI_CONNECTOR_MOCK ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return MOCKS.filter((m) => wanted.includes(m.id) || wanted.includes("all"));
}

/** Demo sign-in values per mocked provider, for the Settings form. Empty unless mocks are on. */
export const mockDemoValues = (): Record<string, Record<string, string>> => Object.fromEntries(activeMocks().map((m) => [m.id, m.demoValues]));

/** The mock that should answer this URL, if any. */
export const mockFetchFor = (url: string): FetchLike | undefined => activeMocks().find((m) => m.matches(url))?.fetch;
