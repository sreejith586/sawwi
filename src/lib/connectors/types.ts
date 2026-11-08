import type { ParsedTable } from "@/lib/files/parse";

// A connector is just another way a file arrives (D-27, D-28): it pulls a report from a
// provider's API and returns the same table parseUpload returns, with fixed column names
// per report so the mapping cache recognises it next time.

export type CredentialField = {
  key: string;
  label: string;
  /** Secret fields are never sent back to the browser or shown again. */
  secret: boolean;
  /** May be left empty. */
  optional?: boolean;
  placeholder?: string;
  help?: string;
};

export type ConnectorReport = {
  id: string;
  label: string;
  description: string;
  /** Slots this report usually fills: "slot" for any template, or "template/slot" when the
   *  same slot key means different data in different templates. Only a hint for the UI. */
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
  /** Writing draft purchase invoices (D-64). Only connectors that can are push targets. */
  purchaseInvoices?: PurchaseInvoiceWriter<C>;
};

// ─── Writes (D-64) ───────────────────────────────────────────────────────────

export type ErpMasterData = {
  company: string;
  /** The company's local currency; documents in it carry no currency code. */
  lcy: string;
  vendors: { number: string; name: string; trn: string; currency: string }[];
  items: { number: string; name: string; gtin: string }[];
  /** G/L accounts that allow direct posting. */
  accounts: { number: string; name: string }[];
};

export type ErpPurchaseInvoice = {
  vendorNumber: string;
  vendorInvoiceNumber: string;
  invoiceDate: string;
  /** "" lets the ERP apply the vendor's payment terms. */
  dueDate: string;
  currency: string;
  lines: { type: "item" | "account"; number: string; description: string; quantity: number; directUnitCost: number }[];
};

export type ErpDocumentRef = { id: string; number: string; status: string };

export type PurchaseInvoiceWriter<C> = {
  masterData(credentials: C, deps: ConnectorDeps): Promise<ErpMasterData>;
  /** Purchase invoices of this vendor with this vendor invoice number, posted or not (D-63). */
  findExisting(credentials: C, vendorNumber: string, vendorInvoiceNumber: string, deps: ConnectorDeps): Promise<ErpDocumentRef[]>;
  /** Creates an unposted purchase invoice; never posts. Returns it with the ERP's total incl. VAT. */
  createDraft(credentials: C, invoice: ErpPurchaseInvoice, deps: ConnectorDeps): Promise<ErpDocumentRef & { company: string; totalIncludingTax: number | null }>;
};

/** A problem the user can act on (bad token, wrong shop, missing scope). */
export class ConnectorError extends Error {}
