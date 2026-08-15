import { describe, it, expect } from "vitest";
import { filterQuizCards, buildQuizPrompts, isPreviouslyFailed, resolveScopePrefill } from "../../src/lib/quiz/setup";

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
      // `["x" as const]` not `["x"] as const` — the latter is a readonly
      // tuple, which does not satisfy the mutable array the signature takes.
      questionMode: ["multiple-choice" as const],
      promptSide: "term" as const,
      categoryIds: [],
      starredOnly: true,
      failedOnly: false,
      printable: false,
      questionCount: 10,
    };
    const filtered = filterQuizCards(mockCards, setup);
    expect(filtered).toHaveLength(2);
    expect(filtered.map(c => c.id)).toEqual(["1", "3"]);
  });

  it("filters failed only", () => {
    const setup = {
      // `["x" as const]` not `["x"] as const` — the latter is a readonly
      // tuple, which does not satisfy the mutable array the signature takes.
      questionMode: ["multiple-choice" as const],
      promptSide: "term" as const,
      categoryIds: [],
      starredOnly: false,
      failedOnly: true,
      printable: false,
      questionCount: 10,
    };
    const filtered = filterQuizCards(mockCards, setup, mockAnswers);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("1");
  });

  it("filters categories", () => {
    const setup = {
      // `["x" as const]` not `["x"] as const` — the latter is a readonly
      // tuple, which does not satisfy the mutable array the signature takes.
      questionMode: ["multiple-choice" as const],
      promptSide: "term" as const,
      categoryIds: ["cat1"],
      starredOnly: false,
      failedOnly: false,
      printable: false,
      questionCount: 10,
    };
    const filtered = filterQuizCards(mockCards, setup);
    expect(filtered).toHaveLength(2);
    expect(filtered.map(c => c.id)).toEqual(["1", "3"]);
  });

  it("builds prompts for term side", () => {
    const setup = {
      // `["x" as const]` not `["x"] as const` — the latter is a readonly
      // tuple, which does not satisfy the mutable array the signature takes.
      questionMode: ["multiple-choice" as const],
      promptSide: "term" as const,
      categoryIds: [],
      starredOnly: false,
      failedOnly: false,
      printable: false,
      questionCount: 10,
    };
    const prompts = buildQuizPrompts(mockCards, setup);
    expect(prompts[0].prompt).toBe("T1");
    expect(prompts[1].prompt).toBe("T2");
  });
});

describe("resolveScopePrefill (Spec 3C §6.5)", () => {
  const CATEGORIES = [
    { id: "c-acct-in-set-a", normalizedName: "accounting" },
    { id: "c-val-in-set-a", normalizedName: "valuation" },
  ];

  it("prefills nothing when no scope is saved", () => {
    const out = resolveScopePrefill({
      setId: "set-a",
      scope: { setIds: [], categoryKeys: [] },
      categories: CATEGORIES,
    });
    // Empty means "everything in this set", which is the existing behaviour.
    expect(out).toEqual({ categoryIds: [], outOfScope: false });
  });

  it("resolves cross-set names to THIS set's category ids", () => {
    // The scope stores `accounting`; QuizSetup needs the per-set row's id.
    const out = resolveScopePrefill({
      setId: "set-a",
      scope: { setIds: [], categoryKeys: ["accounting"] },
      categories: CATEGORIES,
    });
    expect(out.categoryIds).toEqual(["c-acct-in-set-a"]);
    expect(out.outOfScope).toBe(false);
  });

  it("prefills nothing and flags it when the set is outside the scope", () => {
    const out = resolveScopePrefill({
      setId: "set-b",
      scope: { setIds: ["set-a"], categoryKeys: ["accounting"] },
      categories: CATEGORIES,
    });
    expect(out).toEqual({ categoryIds: [], outOfScope: true });
  });

  it("prefills normally when the set IS in the scope's set list", () => {
    const out = resolveScopePrefill({
      setId: "set-a",
      scope: { setIds: ["set-a", "set-b"], categoryKeys: ["accounting"] },
      categories: CATEGORIES,
    });
    expect(out.categoryIds).toEqual(["c-acct-in-set-a"]);
    expect(out.outOfScope).toBe(false);
  });

  it("returns an EMPTY prefill when no scoped category exists in this set", () => {
    // Never an empty-but-active filter: that selects zero cards and produces a
    // quiz with no questions. Empty means everything.
    const out = resolveScopePrefill({
      setId: "set-a",
      scope: { setIds: [], categoryKeys: ["biology"] },
      categories: CATEGORIES,
    });
    expect(out).toEqual({ categoryIds: [], outOfScope: false });
  });

  it("resolves several categories at once", () => {
    const out = resolveScopePrefill({
      setId: "set-a",
      scope: { setIds: [], categoryKeys: ["accounting", "valuation"] },
      categories: CATEGORIES,
    });
    expect(out.categoryIds).toEqual(["c-acct-in-set-a", "c-val-in-set-a"]);
  });

  it("does not exclude a set when the scope names only categories", () => {
    // An empty setIds means every set — only a NON-EMPTY list can exclude one.
    const out = resolveScopePrefill({
      setId: "set-z",
      scope: { setIds: [], categoryKeys: ["accounting"] },
      categories: CATEGORIES,
    });
    expect(out.outOfScope).toBe(false);
  });
});
