import { describe, expect, it } from "vitest";
import { CHAT_MAX_WIDTH, CHAT_MIN_WIDTH, CHAT_PANEL_SCRIPT, clampChatWidth } from "./chat-panel";

// The right chat panel's width (D-33): dragged by its left border, kept within limits.

describe("chat panel width", () => {
  it("stays between the minimum and maximum", () => {
    expect(clampChatWidth(100, 1600)).toBe(CHAT_MIN_WIDTH);
    expect(clampChatWidth(450.6, 1600)).toBe(451);
    expect(clampChatWidth(5000, 2400)).toBe(CHAT_MAX_WIDTH);
  });

  it("never takes more than 60% of the window", () => {
    expect(clampChatWidth(700, 1000)).toBe(600);
    // On a very small window the minimum still wins, so the panel stays usable.
    expect(clampChatWidth(700, 400)).toBe(CHAT_MIN_WIDTH);
  });

  it("restores the saved state before paint without throwing on bad storage", () => {
    expect(CHAT_PANEL_SCRIPT).toContain('localStorage.getItem("sawwi-chat")');
    expect(CHAT_PANEL_SCRIPT).toContain("try{");
  });
});
