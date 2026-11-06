import type { B2BPaymentMethod, Channel, PaymentMethod, Role } from "@/lib/profile/options";

// A template is a declarative spec. The UI renders it, and the matching engine
// (Phase 3) executes it. The LLM only maps uploaded columns onto `fields`.

export type FieldType = "id" | "text" | "date" | "money" | "number" | "percent";

export type CanonicalField = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
};

export type SourceSlot = {
  key: string;
  label: string;
  description: string;
  /** Typical exports users upload into this slot. */
  examples: string[];
  /** Optional slots don't block a run when no file is uploaded. */
  optional?: boolean;
  fields: CanonicalField[];
};

export type KeyNormalizer = "trim" | "upper" | "strip_non_alnum" | "strip_leading_zeros";

export type LinkKey = {
  /** Field on the link's left slot. */
  left: string;
  /** Field on the link's right slot. */
  right: string;
  normalize?: KeyNormalizer[];
  /**
   * "equals" (default) compares normalized values.
   * "contains": the left key appears inside the right value, e.g. an invoice number in a bank narration.
   * "month": both fields are dates, grouped by calendar month (for totals that only reconcile per period).
   */
  mode?: "equals" | "contains" | "month";
};

export type Cardinality = "one_to_one" | "one_to_many" | "many_to_one" | "many_to_many";

/**
 * How two uploaded files connect. Keys combine with AND (a composite key) unless
 * `combine` is "or", where later keys are fallbacks for rows the earlier ones missed.
 * "many_to_one" is a lookup: each left row is enriched with its right row (rate cards,
 * price lists, catalogues), and later lookup links can chain off the enriched record.
 */
export type Link = {
  left: string;
  right: string;
  keys: LinkKey[];
  combine?: "and" | "or";
  cardinality: Cardinality;
  /**
   * Amount comparison. Expressions use canonical field names with + - * / ( ) and abs().
   * Lookups evaluate both on the merged record; otherwise each side is summed per key group.
   */
  amount?: { left: string; right: string; tolerance: number };
  /** Allowed gap between the two sides' primary dates, in days. */
  dateWindowDays?: number;
};

/** A filter on a raw cell value (case-insensitive regex). */
export type Where = { field: string; pattern: string; negate?: boolean };

/**
 * Declarative check rules the engine evaluates generically. Links are referenced by index.
 * A check without a rule is reported as "not automated yet", never silently passed.
 */
export type CheckRule =
  | { kind: "unmatched_left"; link: number; where?: Where }
  | { kind: "unmatched_right"; link: number; where?: Where }
  | {
      kind: "compare";
      link: number;
      direction: "left_higher" | "right_higher" | "either";
      /** Defaults to the link's amount expressions and tolerance. */
      left?: string;
      right?: string;
      tolerance?: number;
      leftWhere?: Where;
      rightWhere?: Where;
    }
  | { kind: "duplicate"; link: number; side: "left" | "right" }
  | { kind: "multi_value"; link: number; side: "left" | "right"; field: string }
  | { kind: "older_than"; link: number; field: string; days: number }
  | { kind: "due_within"; link: number; field: string; days: number }
  | { kind: "row_match"; slot: string; where: Where }
  | { kind: "pair_match"; link: number; leftWhere: Where; rightWhere: Where }
  | { kind: "date_outside"; link: number; date: string; from: string; to: string }
  | { kind: "vat_rate"; slot: string; gross: string; vat: string };

export type Check = { id: string; label: string; description: string; rule?: CheckRule };

export type TemplateGroup = "marketplace" | "webstore" | "b2b" | "payouts";

export type Template = {
  id: string;
  title: string;
  summary: string;
  group: TemplateGroup;
  frequency: "daily" | "weekly" | "per_settlement" | "monthly";
  appliesTo: {
    channels: Channel[];
    /** Shown only if the seller uses at least one of these payment methods. */
    payments?: PaymentMethod[];
    /** Shown only if the seller's business customers pay with one of these. */
    b2bPayments?: B2BPaymentMethod[];
    requiresCreditTerms?: boolean;
    requiresB2B?: boolean;
    requiresMarketplaceFulfilment?: boolean;
  };
  /** Roles that usually own this reco; used for ranking. */
  roles: Role[];
  /** Marks the hard marketplace edge cases that set Sawwina apart. */
  featured?: boolean;
  sources: SourceSlot[];
  links: Link[];
  checks: Check[];
  outputs: string[];
};

export const GROUP_LABELS: Record<TemplateGroup, string> = {
  marketplace: "Marketplace seller",
  webstore: "Own webstore",
  b2b: "Direct B2B sales",
  payouts: "Payouts & bank",
};

export const FREQUENCY_LABELS: Record<Template["frequency"], string> = {
  daily: "Daily",
  weekly: "Weekly",
  per_settlement: "Every settlement",
  monthly: "Monthly",
};
