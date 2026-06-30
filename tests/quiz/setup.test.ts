import { describe, it, expect } from "vitest";
import { filterQuizCards, buildQuizPrompts, isPreviouslyFailed } from "../../src/lib/quiz/setup";

describe("quiz setup helpers", () => {
  const mockCards = [
    { id: "1", term: "T1", definition: "D1", starred: true, categoryIds: ["cat1"] },
    { id: "2", term: "T2", definition: "D2", starred: false, categoryIds: ["cat2"] },
    { id: "3", term: "T3", definition: "D3", starred: true, categoryIds: ["cat1"] },
  ];

  const mockAnswers = [
    { cardId: "1", isCorrect: false },
  ];

  it("filters starred only", () => {
    const setup = {
      questionMode: "multiple-choice",
      promptSide: "term",
      categoryIds: [],
      starredOnly: true,
      failedOnly: false,
      printable: false,
    };
    const filtered = filterQuizCards(mockCards, setup);
    expect(filtered).toHaveLength(2);
    expect(filtered.map(c => c.id)).toEqual(["1", "3"]);
  });

  it("filters failed only", () => {
    const setup = {
      questionMode: "multiple-choice",
      promptSide: "term",
      categoryIds: [],
      starredOnly: false,
      failedOnly: true,
      printable: false,
    };
    const filtered = filterQuizCards(mockCards, setup, mockAnswers);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("1");
  });

  it("filters categories", () => {
    const setup = {
      questionMode: "multiple-choice",
      promptSide: "term",
      categoryIds: ["cat1"],
      starredOnly: false,
      failedOnly: false,
      printable: false,
    };
    const filtered = filterQuizCards(mockCards, setup);
    expect(filtered).toHaveLength(2);
    expect(filtered.map(c => c.id)).toEqual(["1", "3"]);
  });

  it("builds prompts for term side", () => {
    const setup = {
      questionMode: "multiple-choice",
      promptSide: "term" as const,
      categoryIds: [],
      starredOnly: false,
      failedOnly: false,
      printable: false,
    };
    const prompts = buildQuizPrompts(mockCards, setup);
    expect(prompts[0].prompt).toBe("T1");
    expect(prompts[1].prompt).toBe("T2");
  });
});
