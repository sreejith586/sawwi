import type { FetchLike } from "../types";
import { DEMO_BC_CREDENTIALS, isBusinessCentralUrl, mockBusinessCentral } from "./business-central";

// Local demo mode (D-29): with SAWWI_CONNECTOR_MOCK=business-central (or "all"), requests to
// Business Central's hosts are answered in-process by the mock tenant instead of Microsoft.
// Never in production: there the variable is ignored.

type Mock = { id: string; matches: (url: string) => boolean; fetch: FetchLike; demoValues: Record<string, string> };

const MOCKS: Mock[] = [{ id: "business-central", matches: isBusinessCentralUrl, fetch: mockBusinessCentral({ pageSize: 50 }), demoValues: DEMO_BC_CREDENTIALS }];

export function activeMocks(): Mock[] {
  if (process.env.NODE_ENV === "production") return [];
  const wanted = (process.env.SAWWI_CONNECTOR_MOCK ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return MOCKS.filter((m) => wanted.includes(m.id) || wanted.includes("all"));
}

/** Demo sign-in values per mocked provider, for the Settings form. Empty unless mocks are on. */
export const mockDemoValues = (): Record<string, Record<string, string>> => Object.fromEntries(activeMocks().map((m) => [m.id, m.demoValues]));

/** The mock that should answer this URL, if any. */
export const mockFetchFor = (url: string): FetchLike | undefined => activeMocks().find((m) => m.matches(url))?.fetch;
