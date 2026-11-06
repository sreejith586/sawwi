import type { FileProfile } from "@/lib/files/profile";
import type { KeyNormalizer } from "@/lib/templates/types";

export type MappingSource = "remembered" | "auto" | "ai" | "user";

export type FieldMapping = { column: string | null; source: MappingSource; confidence: number };

export type SlotMapping = {
  fields: Record<string, FieldMapping>;
  /** Answers to ambiguous d/m vs m/d date columns, by column name. */
  dateFormats: Record<string, "DMY" | "MDY">;
  /** Currency for files with no currency column. */
  currency?: string;
};

export type RunStatus = "collecting" | "clarifying" | "ready" | "done";

export type Run = { id: string; orgKey: string; templateId: string; status: RunStatus; createdAt: string };

export type RunFile = {
  slotKey: string;
  fileName: string;
  storedPath: string;
  profile: FileProfile;
  mapping: SlotMapping;
};

export type QuestionPayload =
  | { kind: "confirm_column"; field: string; column: string }
  | { kind: "choose_column"; field: string; options: string[] }
  | { kind: "date_format"; column: string; samples: string[] }
  | { kind: "currency"; options: string[] }
  | {
      kind: "key_format";
      keyIndex: number;
      fieldLabel: string;
      leftExample: string;
      rightExample: string;
      normalizers: KeyNormalizer[];
    };

export type Question = {
  id: string;
  seq: number;
  slotKey: string | null;
  payload: QuestionPayload;
  answer: string | null;
};

/** Who wrote a chat answer: Claude, or Sawwi's own code (no API key, or a deterministic answer). */
export type AnswerSource = "ai" | "rules";

export type BreakdownRow = { group: string; count: number; value: number };

/** Structured chat content rendered as a card under the message text. */
export type ChatPayload =
  | { type: "email"; source: AnswerSource; audience: string; subject: string; body: string }
  | {
      type: "breakdown";
      source: AnswerSource;
      check: string;
      checkLabel: string;
      by: string;
      byLabel: string;
      currency?: string;
      rows: BreakdownRow[];
      totalGroups: number;
    }
  | { type: "fix_first"; source: AnswerSource; items: { checkLabel: string; severity: "high" | "medium" | "info"; count: number; value: number; action: string }[] }
  | { type: "answer"; source: AnswerSource }
  /** A follow-up question or one-click action from the user. */
  | { type: "question" };

export type Message = { id: number; role: "sawwi" | "user"; body: string; questionId: string | null; payload?: ChatPayload };

export const NONE_OPTION = "__none__";
