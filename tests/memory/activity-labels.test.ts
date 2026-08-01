import { describe, it, expect } from "vitest";
import {
  ACTIVITY_LABELS,
  activityLabel,
  formatDuration,
} from "../../src/lib/memory/activity-labels";

describe("activityLabel", () => {
  it("maps known kinds to their UI label", () => {
    expect(activityLabel("quiz")).toBe("Quiz");
    expect(activityLabel("matching")).toBe("Matching Game");
    expect(activityLabel("confidence")).toBe("Confidence Ranking");
  });

  it("falls back to a generic label for an unknown kind, never the raw string", () => {
    expect(activityLabel("multiple-choice")).toBe("Study session");
    expect(activityLabel("short-answer")).toBe("Study session");
    expect(activityLabel("")).toBe("Study session");
  });

  it("matches ACTIVITY_LABELS exactly for known kinds", () => {
    for (const [kind, label] of Object.entries(ACTIVITY_LABELS)) {
      expect(activityLabel(kind)).toBe(label);
    }
  });
});

describe("formatDuration", () => {
  it("renders an em dash for null (legacy sessions predating timing)", () => {
    expect(formatDuration(null)).toBe("—");
  });

  it("renders sub-minute durations as seconds only", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(59_000)).toBe("59s");
  });

  it("renders minute-plus durations as minutes and seconds", () => {
    expect(formatDuration(60_000)).toBe("1m 0s");
    expect(formatDuration(522_000)).toBe("8m 42s");
    expect(formatDuration(3_661_000)).toBe("61m 1s");
  });

  it("rounds to the nearest second", () => {
    expect(formatDuration(44_600)).toBe("45s");
    expect(formatDuration(44_400)).toBe("44s");
  });
});
