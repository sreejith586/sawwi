import type { ParsedTable } from "@/lib/files/parse";

// A connector is just another way a file arrives (D-27, D-28): it pulls a report from a
// provider's API and returns the same table parseUpload returns, with fixed column names
// per report so the mapping cache recognises it next time.

export type CredentialField = {
  key: string;
  label: string;
  /** Secret fields are never sent back to the browser or shown again. */
  secret: boolean;
  placeholder?: string;
  help?: string;
};

export type ConnectorReport = {
  id: string;
  label: string;
  description: string;
  /** Template slot keys this report usually fills; only a hint for the UI. */
  slots: string[];
};

/** Inclusive ISO days, UTC. */
export type PullWindow = { from: string; to: string };

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export type ConnectorDeps = {
  fetch: FetchLike;
  /** Waits between retries; tests pass a no-op. */
  sleep: (ms: number) => Promise<void>;
};

export type Connector<C extends Record<string, string> = Record<string, string>> = {
  id: string;
  label: string;
  description: string;
  fields: CredentialField[];
  reports: ConnectorReport[];
  /** Normalises and validates what the user typed; throws ConnectorError with a message for them. */
  parseCredentials(input: Record<string, string>): C;
  /** A short label for the account, e.g. the shop name, from a cheap read-only call. */
  test(credentials: C, deps: ConnectorDeps): Promise<{ accountLabel: string }>;
  pull(credentials: C, report: string, window: PullWindow, deps: ConnectorDeps): Promise<ParsedTable>;
};

/** A problem the user can act on (bad token, wrong shop, missing scope). */
export class ConnectorError extends Error {}
