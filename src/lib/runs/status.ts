import type { RunStatus } from "./types";

export type StatusTone = "neutral" | "medium" | "info" | "ok";

/** One wording and color per run status, shared by the workspace, home and history. */
export const RUN_STATUS: Record<RunStatus, { label: string; tone: StatusTone }> = {
  collecting: { label: "Waiting for files", tone: "neutral" },
  clarifying: { label: "Needs your answers", tone: "medium" },
  ready: { label: "Ready to reconcile", tone: "info" },
  done: { label: "Reconciled", tone: "ok" },
};
