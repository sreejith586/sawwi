import { describe, expect, it } from "vitest";
import { estimateRemaining, FIRST_GUESS_MS, type UploadItem } from "./upload-progress";

// The time-left estimate on a bulk upload (D-93).
describe("bulk upload time left", () => {
  const now = 1_000_000;

  it("guesses before any file is read, shared across the parallel readers", () => {
    const items: UploadItem[] = Array.from({ length: 6 }, (_, i) => ({ name: `f${i}`, state: "waiting" }));
    expect(estimateRemaining(items, 3, now)).toBe((6 * FIRST_GUESS_MS) / 3);
  });

  it("learns from the files already read, and counts what's left of those being read", () => {
    const items: UploadItem[] = [
      { name: "a", state: "done", ms: 30_000 },
      { name: "b", state: "done", ms: 50_000 },
      { name: "c", state: "reading", startedAt: now - 10_000 },
      { name: "d", state: "waiting" },
      { name: "e", state: "waiting" },
    ];
    // Average 40s: c has 30s left, d and e 40s each; three readers share 110s.
    expect(estimateRemaining(items, 3, now)).toBeCloseTo(110_000 / 3);
  });

  it("never counts less than a few seconds for a file running over the average, and nothing when all is done", () => {
    const slow: UploadItem[] = [
      { name: "a", state: "done", ms: 20_000 },
      { name: "b", state: "reading", startedAt: now - 90_000 },
    ];
    expect(estimateRemaining(slow, 3, now)).toBe(5_000);
    expect(estimateRemaining([{ name: "a", state: "failed", ms: 1_000 }], 3, now)).toBeNull();
  });
});
