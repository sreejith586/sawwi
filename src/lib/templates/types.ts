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

export type MatchKey = {
  left: `${string}.${string}`;
  right: `${string}.${string}`;
  normalize?: KeyNormalizer[];
  /** "contains": the left key appears inside the right value, e.g. an invoice number in a bank narration. */
  mode?: "equals" | "contains";
};

export type MatchSpec = {
  keys: MatchKey[];
  cardinality: "one_to_one" | "one_to_many" | "many_to_one" | "many_to_many";
  /** Amount comparison: expressions over canonical fields of each side. */
  amount?: { left: string; right: string; tolerance: number };
  /** Allowed gap between the two sides' dates, in days. */
  dateWindowDays?: number;
};

export type Check = { id: string; label: string; description: string };

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
  /** Marks the hard marketplace edge cases that set Sawwi apart. */
  featured?: boolean;
  sources: SourceSlot[];
  match: MatchSpec;
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
