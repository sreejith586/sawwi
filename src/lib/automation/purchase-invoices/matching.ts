import type { Draft, DraftLine, LineType, MatchedBy } from "./draft";

// Supplier → ERP vendor and line → ERP item or G/L account (D-62). Exact rules only, first hit
// wins: a wrong item on a purchase invoice costs more than one click to pick the right one.

export type ErpVendor = { number: string; name: string; trn: string; currency: string };
export type ErpItem = { number: string; name: string; gtin: string };
export type ErpAccount = { number: string; name: string };
export type MasterData = { company: string; lcy: string; vendors: ErpVendor[]; items: ErpItem[]; accounts: ErpAccount[]; fetchedAt: string };

/** What Sawwi has learned about one supplier from the drafts the user pushed or exported (D-61). */
export type SupplierProfile = {
  issuerKey: string;
  trn: string;
  supplierName: string;
  vendorNo: string;
  vendorName: string;
  /** lineKey() → the ERP item or account the user chose for it. */
  lines: Record<string, { type: LineType; no: string }>;
  /** Days from invoice date to due date, for invoices that print no due date. */
  termsDays: number | null;
};

const LEGAL = new Set(["llc", "l", "fze", "fzco", "fzc", "fz", "co", "company", "est", "establishment", "trading", "trd", "general", "ltd", "limited", "inc", "wll", "spc", "saoc", "jsc", "the", "and", "for", "of", "llp", "plc", "group", "uae", "ksa", "dmcc"]);

/** Lower case, no punctuation or legal suffixes: "Gulf Lighting Supplies L.L.C." → "gulf lighting supplies". */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w && !LEGAL.has(w))
    .join(" ");
}

const normCode = (s: string) => s.toUpperCase().replace(/[\s\-_.]/g, "");

/** The memory key for a line: its supplier SKU if printed, else its description. */
export function lineKey(l: Pick<DraftLine, "sku" | "description">): string {
  return l.sku.trim() ? `sku:${normCode(l.sku)}` : `desc:${normName(l.description)}`;
}

export function matchVendor(d: Draft, md: MasterData, profile?: SupplierProfile): { vendor: ErpVendor; by: MatchedBy } | undefined {
  const byNo = (no: string) => md.vendors.find((v) => v.number === no);
  if (profile?.vendorNo && byNo(profile.vendorNo)) return { vendor: byNo(profile.vendorNo)!, by: "memory" };
  const trn = d.supplierTrn.replace(/\s/g, "");
  if (trn) {
    const hits = md.vendors.filter((v) => v.trn.replace(/\s/g, "") === trn);
    if (hits.length === 1) return { vendor: hits[0], by: "trn" };
  }
  const name = normName(d.supplierName);
  if (name) {
    const hits = md.vendors.filter((v) => normName(v.name) === name);
    if (hits.length === 1) return { vendor: hits[0], by: "name" };
  }
  return undefined;
}

export function matchLine(l: DraftLine, md: MasterData, profile?: SupplierProfile): { type: LineType; no: string; by: MatchedBy } | undefined {
  const remembered = profile?.lines[lineKey(l)];
  if (remembered) {
    const exists = remembered.type === "item" ? md.items.some((i) => i.number === remembered.no) : md.accounts.some((a) => a.number === remembered.no);
    if (exists) return { ...remembered, by: "memory" };
  }
  const sku = normCode(l.sku);
  if (sku) {
    const item = md.items.find((i) => normCode(i.number) === sku);
    if (item) return { type: "item", no: item.number, by: "sku" };
    const gtin = md.items.filter((i) => i.gtin && normCode(i.gtin) === sku);
    if (gtin.length === 1) return { type: "item", no: gtin[0].number, by: "gtin" };
  }
  const desc = normName(l.description);
  if (desc) {
    const hits = md.items.filter((i) => normName(i.name) === desc);
    if (hits.length === 1) return { type: "item", no: hits[0].number, by: "name" };
  }
  return undefined;
}

/**
 * Fills in what's still blank: the vendor, each line's item or account, and the due date from
 * remembered payment terms. Never overwrites a choice already on the draft.
 */
export function applyMatches(d: Draft, md: MasterData | undefined, profile: SupplierProfile | undefined, addDays: (iso: string, n: number) => string): Draft {
  const out: Draft = { ...d, lines: d.lines.map((l) => ({ ...l })) };
  if (!out.dueDate && out.invoiceDate && profile?.termsDays != null) out.dueDate = addDays(out.invoiceDate, profile.termsDays);
  if (!md) return out;
  if (!out.vendorNo) {
    const v = matchVendor(out, md, profile);
    if (v) Object.assign(out, { vendorNo: v.vendor.number, vendorName: v.vendor.name, vendorMatchedBy: v.by });
  }
  for (const l of out.lines) {
    if (l.erpType && l.erpNo) continue;
    const m = matchLine(l, md, profile);
    if (m) Object.assign(l, { erpType: m.type, erpNo: m.no, matchedBy: m.by });
  }
  return out;
}

/** The profile after a reviewed draft was pushed or exported: its vendor, line codings and terms. */
export function learnFromDraft(prev: SupplierProfile | undefined, issuerKey: string, d: Draft, daysBetween: (a: string, b: string) => number): SupplierProfile {
  const lines = { ...(prev?.lines ?? {}) };
  for (const l of d.lines) if (l.erpType && l.erpNo && (l.sku.trim() || l.description.trim())) lines[lineKey(l)] = { type: l.erpType, no: l.erpNo };
  const terms = d.invoiceDate && d.dueDate ? daysBetween(d.invoiceDate, d.dueDate) : null;
  return {
    issuerKey,
    trn: d.supplierTrn || prev?.trn || "",
    supplierName: d.supplierName || prev?.supplierName || "",
    vendorNo: d.vendorNo || prev?.vendorNo || "",
    vendorName: d.vendorName || prev?.vendorName || "",
    lines,
    termsDays: terms !== null && terms >= 0 && terms <= 365 ? terms : prev?.termsDays ?? null,
  };
}
