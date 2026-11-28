import { createHash } from "node:crypto";
import { ConnectorError, type ConnectorDeps } from "../types";
import { DEMO_BC_CREDENTIALS, isBusinessCentralUrl, mockBusinessCentral, type MockBooks } from "./business-central";

// A local mock Business Central sandbox (D-94), for development only: the mock tenant (D-29)
// with one more company whose vendors, items, purchase orders and goods receipts come from a JSON
// file named by SAWWI_MOCK_BC_SANDBOX. Any local workspace can then match and push against it, as
// it would against a customer's sandbox, without a Microsoft tenant. The file can hold a customer's
// suppliers and item barcodes, so it lives outside the repository (e.g. in the ignored .data
// folder). Never available in production, and nothing here reaches the network.

export const SANDBOX_CONNECTION_ID = "sandbox:business-central";

/** The sandbox file's shape: plain records, turned into API v2.0 documents by `sandboxBooks`. */
export type SandboxFile = {
  company: string;
  /** The company's local currency, e.g. "SAR". */
  currency: string;
  /** VAT the mock charges on purchase invoice lines it creates. */
  vatPercent: number;
  vendors: { number: string; name: string; trn?: string }[];
  items: { number: string; name: string; gtin?: string }[];
  accounts?: { number: string; name: string }[];
  purchaseOrders: { number: string; date: string; vendor: string; lines: { item: string; qty: number; price: number; received?: number; invoiced?: number }[] }[];
  purchaseReceipts: { number: string; date: string; vendor: string; order: string; lines: { item: string; qty: number; price: number }[] }[];
};

/** The sandbox file, or undefined when the sandbox is off (always in production). */
export function sandboxPath(): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  return process.env.SAWWI_MOCK_BC_SANDBOX?.trim() || undefined;
}

/** A stable GUID from a name, so ids survive a restart and match across reads. */
const guid = (key: string) => {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The file's records as the mock's books: the documents Business Central's API would return. */
export function sandboxBooks(f: SandboxFile): MockBooks {
  const vendorName = Object.fromEntries(f.vendors.map((v) => [v.number, v.name]));
  const itemName = Object.fromEntries(f.items.map((i) => [i.number, i.name]));
  const tax = (net: number) => r2((net * f.vatPercent) / 100);
  const company = { id: guid(`company:${f.company}`), name: f.company, displayName: f.company };
  const purchaseOrders = f.purchaseOrders.map((o) => {
    const lines = o.lines.map((l, i) => {
      const received = l.received ?? 0;
      const invoiced = l.invoiced ?? 0;
      const net = r2(l.qty * l.price);
      return {
        id: guid(`pol:${o.number}:${i}`),
        sequence: (i + 1) * 10000,
        lineType: "Item",
        lineObjectNumber: l.item,
        description: itemName[l.item] ?? l.item,
        unitOfMeasureCode: "PCS",
        quantity: l.qty,
        directUnitCost: l.price,
        netAmount: net,
        netTaxAmount: tax(net),
        receivedQuantity: received,
        invoicedQuantity: invoiced,
        // Business Central's defaults: receive the rest, invoice what's received and not invoiced.
        receiveQuantity: l.qty - received,
        invoiceQuantity: received - invoiced,
      };
    });
    const ex = r2(lines.reduce((s, l) => s + l.netAmount, 0));
    return {
      id: guid(`po:${o.number}`),
      number: o.number,
      orderDate: o.date,
      postingDate: o.date,
      vendorNumber: o.vendor,
      vendorName: vendorName[o.vendor] ?? o.vendor,
      currencyCode: "",
      totalAmountExcludingTax: ex,
      totalAmountIncludingTax: r2(ex + tax(ex)),
      fullyReceived: o.lines.every((l) => (l.received ?? 0) >= l.qty),
      status: "Open",
      purchaseOrderLines: lines,
    };
  });
  const purchaseReceipts = f.purchaseReceipts.map((r) => ({
    id: guid(`grn:${r.number}`),
    number: r.number,
    postingDate: r.date,
    vendorNumber: r.vendor,
    vendorName: vendorName[r.vendor] ?? r.vendor,
    currencyCode: "",
    orderNumber: r.order,
    purchaseReceiptLines: r.lines.map((l, i) => ({
      id: guid(`grnl:${r.number}:${i}`),
      sequence: (i + 1) * 10000,
      lineType: "Item",
      lineObjectNumber: l.item,
      description: itemName[l.item] ?? l.item,
      unitOfMeasureCode: "PCS",
      unitCost: l.price,
      quantity: l.qty,
      taxPercent: f.vatPercent,
    })),
  }));
  return {
    company,
    info: [{ id: guid(`info:${f.company}`), displayName: f.company, currencyCode: f.currency, mockVatPercent: f.vatPercent }],
    data: {
      vendors: f.vendors.map((v) => ({ id: guid(`vendor:${v.number}`), number: v.number, displayName: v.name, taxRegistrationNumber: v.trn ?? "", currencyCode: "", blocked: " " })),
      items: f.items.map((i) => ({ id: guid(`item:${i.number}`), number: i.number, displayName: i.name, type: "Inventory", baseUnitOfMeasureCode: "PCS", gtin: i.gtin ?? "", blocked: false })),
      accounts: (f.accounts ?? []).map((a) => ({ id: guid(`account:${a.number}`), number: a.number, displayName: a.name, category: "Expense", accountType: "Posting", directPosting: true, blocked: false })),
      purchaseOrders,
      purchaseReceipts,
      purchaseInvoices: [],
    },
  };
}

/** Sign-in values for the sandbox company: the mock tenant's, with this company. */
export const sandboxCredentials = (f: SandboxFile) => ({ ...DEMO_BC_CREDENTIALS, company: f.company });

// Read once per file version; writes (draft invoices, order lines set up to invoice) stay in memory until restart.
let loaded: { path: string; mtime: number; file: SandboxFile; fetch: ReturnType<typeof mockBusinessCentral> } | undefined;
const writes = new Map<string, Record<string, unknown>[]>();

/** The sandbox's file and a fetch that answers it in-process, or undefined when it's off. */
export async function loadSandbox(): Promise<{ file: SandboxFile; deps: ConnectorDeps } | undefined> {
  const path = sandboxPath();
  if (!path) return undefined;
  // Imported at run time, out of the bundler's sight: a file read by a path from the environment
  // would otherwise make the build trace, and deploy, the whole project (D-94).
  const fs = await import(/* turbopackIgnore: true */ /* webpackIgnore: true */ "node:fs");
  let mtime: number;
  try {
    mtime = fs.statSync(path).mtimeMs;
  } catch {
    throw new ConnectorError(`The mock Business Central sandbox file ${path} wasn't found.`);
  }
  if (!loaded || loaded.path !== path || loaded.mtime !== mtime) {
    const file = JSON.parse(fs.readFileSync(path, "utf8")) as SandboxFile;
    loaded = { path, mtime, file, fetch: mockBusinessCentral({ pageSize: 100, writes, books: [sandboxBooks(file)] }) };
  }
  const { fetch } = loaded;
  return {
    file: loaded.file,
    deps: {
      fetch: async (url, init) => {
        if (isBusinessCentralUrl(url)) return fetch(url, init);
        throw new ConnectorError("The mock sandbox only answers Business Central requests.");
      },
      sleep: async () => {},
    },
  };
}
