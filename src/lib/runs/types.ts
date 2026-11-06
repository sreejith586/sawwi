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

export type Message = { id: number; role: "sawwi" | "user"; body: string; questionId: string | null };

export const NONE_OPTION = "__none__";
