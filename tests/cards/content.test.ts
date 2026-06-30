import { describe, it, expect } from "vitest";
import { legacyCardToContentBlocks, contentBlocksToPlainText } from "../../src/lib/cards/content";

describe("content helpers", () => {
  it("converts legacy cards to content blocks", () => {
    const blocks = legacyCardToContentBlocks("Term", "Definition");
    expect(blocks.term).toEqual([{ type: "text", text: "Term", position: 0 }]);
    expect(blocks.definition).toEqual([{ type: "text", text: "Definition", position: 0 }]);
  });

  it("converts content blocks to plain text", () => {
    const blocks = [
      { type: "text" as const, text: "Line 1", position: 0 },
      { type: "text" as const, text: "Line 2", position: 1 },
    ];
    expect(contentBlocksToPlainText(blocks)).toBe("Line 1\nLine 2");
  });
});
