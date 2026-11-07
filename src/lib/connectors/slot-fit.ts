// Client-safe: ranks a connector report for a run slot (no server imports).

/** 2: hinted for this template's slot ("template/slot"), 1: for any slot with this key, 0: neither. */
export function slotFit(hints: string[], templateId: string, slotKey: string): number {
  if (hints.includes(`${templateId}/${slotKey}`)) return 2;
  return hints.includes(slotKey) ? 1 : 0;
}
