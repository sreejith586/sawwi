import type { CanonicalField, SourceSlot, Template } from "./types";

// "No template fits": a generic two-file reconciliation. The user names the two files and
// picks a tolerance; Sawwi then asks (with chips) which column is the key and which is the
// amount in each file. The same spec, renamed, can be saved as a workspace template.

export const GENERIC_TEMPLATE_ID = "generic-two-file";
export const CUSTOM_PREFIX = "custom-";

export type GenericSetup = { leftLabel: string; rightLabel: string; tolerance: number };

export const DEFAULT_SETUP: GenericSetup = { leftLabel: "File A", rightLabel: "File B", tolerance: 0.01 };

/** One-click starting points for the setup form. Labels stay editable. */
export const GENERIC_PRESETS: { label: string; left: string; right: string }[] = [
  { label: "Bank vs ledger", left: "Bank statement", right: "Cash book / ledger" },
  { label: "Payments vs invoices", left: "Invoices", right: "Payments received" },
  { label: "Supplier statement vs ledger", left: "Supplier statement", right: "Supplier ledger" },
  { label: "Orders vs payouts", left: "Orders", right: "Payout report" },
  { label: "Stock count vs book", left: "Stock count", right: "Book stock" },
];

export const TOLERANCE_OPTIONS = [
  { value: "0", label: "Exact" },
  { value: "0.01", label: "± 0.01" },
  { value: "1", label: "± 1" },
  { value: "5", label: "± 5" },
] as const;

const field = (key: string, label: string, type: CanonicalField["type"], required = false): CanonicalField => ({ key, label, type, required });

function slot(key: "left" | "right", label: string): SourceSlot {
  return {
    key,
    label,
    description: `Any CSV or Excel export. Sawwi asks which column is the matching key and which is the amount.`,
    examples: ["CSV", "Excel"],
    fields: [
      field("reference", "Matching key (order, invoice or reference no.)", "id", true),
      field("amount", "Amount", "money", true),
      field("date", "Date", "date"),
      field("description", "Description / narration", "text"),
      field("currency", "Currency", "text"),
    ],
  };
}

export function cleanLabel(raw: string | undefined, fallback: string): string {
  const s = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  return s || fallback;
}

export function parseTolerance(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : DEFAULT_SETUP.tolerance;
}

/** The generic spec for a setup. Pure, so tests and saved templates build the same thing. */
export function genericTemplate(setup: GenericSetup, id = GENERIC_TEMPLATE_ID, title?: string): Template {
  const { leftLabel: L, rightLabel: R, tolerance } = setup;
  const tol = tolerance === 0 ? "exactly" : `within ± ${tolerance}`;
  return {
    id,
    title: title ?? `${L} vs ${R}`,
    summary: `Matches ${L.toLowerCase()} to ${R.toLowerCase()} on a key column and checks amounts agree ${tol}.`,
    group: "custom",
    frequency: "monthly",
    appliesTo: { channels: ["marketplace", "webstore", "b2b"] },
    roles: [],
    confirmColumns: true,
    sources: [slot("left", L), slot("right", R)],
    links: [
      {
        left: "left",
        right: "right",
        keys: [{ left: "reference", right: "reference", normalize: ["trim", "upper"] }],
        cardinality: "many_to_many",
        amount: { left: "amount", right: "amount", tolerance },
      },
    ],
    checks: [
      { id: "missing_right", label: `In ${L}, not in ${R}`, description: `Keys in ${L.toLowerCase()} with no match in ${R.toLowerCase()}.`, rule: { kind: "unmatched_left", link: 0 } },
      { id: "missing_left", label: `In ${R}, not in ${L}`, description: `Keys in ${R.toLowerCase()} with no match in ${L.toLowerCase()}.`, rule: { kind: "unmatched_right", link: 0 } },
      { id: "amount_mismatch", label: "Amount mismatch", description: `Matched keys whose totals differ by more than ${tolerance}.`, rule: { kind: "compare", link: 0, direction: "either" } },
      { id: "duplicate_left", label: `Duplicate keys in ${L}`, description: `The same key appears more than once in ${L.toLowerCase()}.`, rule: { kind: "duplicate", link: 0, side: "left" } },
      { id: "duplicate_right", label: `Duplicate keys in ${R}`, description: `The same key appears more than once in ${R.toLowerCase()}.`, rule: { kind: "duplicate", link: 0, side: "right" } },
    ],
    outputs: ["Matched and unmatched keys", "Amount differences", "Duplicates on either side"],
  };
}

/** A workspace template saved from a generic run: same spec, its own id, title and mapping memory. */
export function customTemplateFrom(setup: GenericSetup, title: string): Template {
  return genericTemplate(setup, `${CUSTOM_PREFIX}${crypto.randomUUID().slice(0, 8)}`, cleanLabel(title, `${setup.leftLabel} vs ${setup.rightLabel}`));
}

export const isCustomId = (id: string) => id.startsWith(CUSTOM_PREFIX);
