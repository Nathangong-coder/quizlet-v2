import { describe, it, expect } from "vitest";
import {
  EMPTY_SCOPE,
  groupCategoriesByName,
  buildStudyEventWhere,
  buildQuizAnswerScopeWhere,
  buildExpressionAnswerWhere,
  serializeScope,
  parseScope,
  isConsolidated,
  type HistoryScope,
} from "../../src/lib/memory/scope";
import { UNCATEGORIZED_ID, CATEGORY_PALETTE } from "../../src/lib/cards/categories";

describe("groupCategoriesByName", () => {
  it("collapses the same category name across sets into one entry", () => {
    const result = groupCategoriesByName([
      { id: "c1", setId: "s1", name: "Valuation", normalizedName: "valuation", color: "#3b82f6", cardCount: 5 },
      { id: "c2", setId: "s2", name: "Valuation", normalizedName: "valuation", color: "#3b82f6", cardCount: 7 },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      key: "valuation",
      name: "Valuation",
      color: "#3b82f6",
      cardCount: 12,
    });
    expect(result[0].setIds).toEqual(["s1", "s2"]);
    expect(result[0].categoryIds).toEqual(["c1", "c2"]);
  });

  it("keeps distinct names separate", () => {
    const result = groupCategoriesByName([
      { id: "c1", setId: "s1", name: "Valuation", normalizedName: "valuation", color: null, cardCount: 1 },
      { id: "c2", setId: "s1", name: "Accounting", normalizedName: "accounting", color: null, cardCount: 2 },
    ]);
    expect(result.map((c) => c.key)).toEqual(["accounting", "valuation"]);
  });

  it("picks the most common display spelling", () => {
    const result = groupCategoriesByName([
      { id: "c1", setId: "s1", name: "valuation", normalizedName: "valuation", color: null, cardCount: 1 },
      { id: "c2", setId: "s2", name: "Valuation", normalizedName: "valuation", color: null, cardCount: 1 },
      { id: "c3", setId: "s3", name: "Valuation", normalizedName: "valuation", color: null, cardCount: 1 },
    ]);
    expect(result[0].name).toBe("Valuation");
  });

  it("picks the most common non-null color", () => {
    const result = groupCategoriesByName([
      { id: "c1", setId: "s1", name: "V", normalizedName: "v", color: null, cardCount: 1 },
      { id: "c2", setId: "s2", name: "V", normalizedName: "v", color: "#a855f7", cardCount: 1 },
      { id: "c3", setId: "s3", name: "V", normalizedName: "v", color: "#a855f7", cardCount: 1 },
      { id: "c4", setId: "s4", name: "V", normalizedName: "v", color: "#ef4444", cardCount: 1 },
    ]);
    expect(result[0].color).toBe("#a855f7");
  });

  it("breaks color ties deterministically by palette order", () => {
    // #ef4444 is palette[0], #a855f7 is palette[7] — equal counts, so the
    // earlier palette entry wins regardless of input ordering.
    const rows = [
      { id: "c1", setId: "s1", name: "V", normalizedName: "v", color: "#a855f7", cardCount: 1 },
      { id: "c2", setId: "s2", name: "V", normalizedName: "v", color: "#ef4444", cardCount: 1 },
    ];
    expect(groupCategoriesByName(rows)[0].color).toBe("#ef4444");
    expect(groupCategoriesByName([...rows].reverse())[0].color).toBe("#ef4444");
    expect(CATEGORY_PALETTE.indexOf("#ef4444")).toBeLessThan(CATEGORY_PALETTE.indexOf("#a855f7"));
  });

  it("falls back to null when no row carries a color", () => {
    const result = groupCategoriesByName([
      { id: "c1", setId: "s1", name: "V", normalizedName: "v", color: null, cardCount: 1 },
    ]);
    expect(result[0].color).toBeNull();
  });

  it("sorts groups by name for a stable chip order", () => {
    const result = groupCategoriesByName([
      { id: "c3", setId: "s1", name: "Zeta", normalizedName: "zeta", color: null, cardCount: 1 },
      { id: "c1", setId: "s1", name: "Alpha", normalizedName: "alpha", color: null, cardCount: 1 },
      { id: "c2", setId: "s1", name: "Mid", normalizedName: "mid", color: null, cardCount: 1 },
    ]);
    expect(result.map((c) => c.name)).toEqual(["Alpha", "Mid", "Zeta"]);
  });

  it("returns an empty array for no rows", () => {
    expect(groupCategoriesByName([])).toEqual([]);
  });

  it("dedupes setIds when one set has two rows normalizing the same", () => {
    const result = groupCategoriesByName([
      { id: "c1", setId: "s1", name: "Valuation", normalizedName: "valuation", color: null, cardCount: 2 },
      { id: "c2", setId: "s1", name: "valuation", normalizedName: "valuation", color: null, cardCount: 3 },
    ]);
    expect(result[0].setIds).toEqual(["s1"]);
    expect(result[0].categoryIds).toEqual(["c1", "c2"]);
  });
});

describe("buildStudyEventWhere", () => {
  const userId = "u1";

  it("scopes to the user only when consolidated", () => {
    expect(buildStudyEventWhere(userId, EMPTY_SCOPE, [])).toEqual({ userId });
  });

  it("filters by sets", () => {
    const where = buildStudyEventWhere(userId, { ...EMPTY_SCOPE, setIds: ["s1", "s2"] }, []);
    expect(where).toEqual({ userId, card: { setId: { in: ["s1", "s2"] } } });
  });

  it("filters by category ids", () => {
    const where = buildStudyEventWhere(userId, { ...EMPTY_SCOPE, categoryKeys: ["valuation"] }, ["c1", "c2"]);
    expect(where).toEqual({
      userId,
      card: { categoryAssignments: { some: { categoryId: { in: ["c1", "c2"] } } } },
    });
  });

  it("filters uncategorized cards via the sentinel", () => {
    const where = buildStudyEventWhere(userId, { ...EMPTY_SCOPE, categoryKeys: [UNCATEGORIZED_ID] }, []);
    expect(where).toEqual({
      userId,
      card: { categoryAssignments: { none: {} } },
    });
  });

  it("ORs a real category with uncategorized", () => {
    const where = buildStudyEventWhere(
      userId,
      { ...EMPTY_SCOPE, categoryKeys: ["valuation", UNCATEGORIZED_ID] },
      ["c1"],
    );
    expect(where).toEqual({
      userId,
      card: {
        OR: [
          { categoryAssignments: { some: { categoryId: { in: ["c1"] } } } },
          { categoryAssignments: { none: {} } },
        ],
      },
    });
  });

  it("ANDs the set and category dimensions", () => {
    const where = buildStudyEventWhere(
      userId,
      { ...EMPTY_SCOPE, setIds: ["s1"], categoryKeys: ["valuation"] },
      ["c1"],
    );
    expect(where).toEqual({
      userId,
      card: {
        setId: { in: ["s1"] },
        categoryAssignments: { some: { categoryId: { in: ["c1"] } } },
      },
    });
  });

  it("lets cardId take precedence over set scope", () => {
    const where = buildStudyEventWhere(userId, { ...EMPTY_SCOPE, setIds: ["s1"], cardId: "card9" }, []);
    expect(where).toEqual({ userId, cardId: "card9" });
  });

  it("narrows by source", () => {
    const where = buildStudyEventWhere(userId, { ...EMPTY_SCOPE, source: "quiz-sa" }, []);
    expect(where).toEqual({ userId, source: "quiz-sa" });
  });

  it("matches nothing when a category scope resolves to no ids", () => {
    // A stale category key from the URL must not silently widen to "everything".
    const where = buildStudyEventWhere(userId, { ...EMPTY_SCOPE, categoryKeys: ["ghost"] }, []);
    expect(where).toEqual({
      userId,
      card: { categoryAssignments: { some: { categoryId: { in: [] } } } },
    });
  });
});

describe("buildQuizAnswerScopeWhere", () => {
  const userId = "u1";

  it("scopes to the user only when consolidated", () => {
    expect(buildQuizAnswerScopeWhere(userId, EMPTY_SCOPE, [])).toEqual({ userId });
  });

  it("filters by sets", () => {
    const where = buildQuizAnswerScopeWhere(userId, { ...EMPTY_SCOPE, setIds: ["s1", "s2"] }, []);
    expect(where).toEqual({ userId, card: { setId: { in: ["s1", "s2"] } } });
  });

  it("filters by category ids", () => {
    const where = buildQuizAnswerScopeWhere(userId, { ...EMPTY_SCOPE, categoryKeys: ["valuation"] }, ["c1", "c2"]);
    expect(where).toEqual({
      userId,
      card: { categoryAssignments: { some: { categoryId: { in: ["c1", "c2"] } } } },
    });
  });

  it("filters uncategorized cards via the sentinel", () => {
    const where = buildQuizAnswerScopeWhere(userId, { ...EMPTY_SCOPE, categoryKeys: [UNCATEGORIZED_ID] }, []);
    expect(where).toEqual({
      userId,
      card: { categoryAssignments: { none: {} } },
    });
  });

  it("ORs a real category with uncategorized", () => {
    const where = buildQuizAnswerScopeWhere(
      userId,
      { ...EMPTY_SCOPE, categoryKeys: ["valuation", UNCATEGORIZED_ID] },
      ["c1"],
    );
    expect(where).toEqual({
      userId,
      card: {
        OR: [
          { categoryAssignments: { some: { categoryId: { in: ["c1"] } } } },
          { categoryAssignments: { none: {} } },
        ],
      },
    });
  });

  it("ANDs the set and category dimensions", () => {
    const where = buildQuizAnswerScopeWhere(
      userId,
      { ...EMPTY_SCOPE, setIds: ["s1"], categoryKeys: ["valuation"] },
      ["c1"],
    );
    expect(where).toEqual({
      userId,
      card: {
        setId: { in: ["s1"] },
        categoryAssignments: { some: { categoryId: { in: ["c1"] } } },
      },
    });
  });

  it("lets cardId take precedence over set scope", () => {
    const where = buildQuizAnswerScopeWhere(userId, { ...EMPTY_SCOPE, setIds: ["s1"], cardId: "card9" }, []);
    expect(where).toEqual({ userId, cardId: "card9" });
  });

  it("translates the scope's StudySource into QuizAnswer's QuizMode vocabulary", () => {
    // `HistoryScope.source` is a StudySource ('quiz-sa'); `QuizAnswer.mode` is
    // a QuizMode ('short-answer'). They are DIFFERENT vocabularies — comparing
    // one to the other matches zero rows, silently.
    const where = buildQuizAnswerScopeWhere(userId, { ...EMPTY_SCOPE, source: "quiz-sa" }, []);
    expect(where).toEqual({ userId, mode: "short-answer" });
  });

  it("translates every quiz source, not just short answer", () => {
    expect(buildQuizAnswerScopeWhere(userId, { ...EMPTY_SCOPE, source: "quiz-mc" }, []))
      .toEqual({ userId, mode: "multiple-choice" });
    expect(buildQuizAnswerScopeWhere(userId, { ...EMPTY_SCOPE, source: "quiz-tf" }, []))
      .toEqual({ userId, mode: "true-false" });
    expect(buildQuizAnswerScopeWhere(userId, { ...EMPTY_SCOPE, source: "matching" }, []))
      .toEqual({ userId, mode: "matching" });
  });

  it("matches nothing for a source that no QuizAnswer can carry", () => {
    // 'review' is a StudySource with no quiz mode. Dropping the filter would
    // silently widen the query back to every mode.
    const where = buildQuizAnswerScopeWhere(userId, { ...EMPTY_SCOPE, source: "review" }, []);
    expect(where).toEqual({ userId, mode: { in: [] } });
  });

  it("matches nothing when a category scope resolves to no ids", () => {
    const where = buildQuizAnswerScopeWhere(userId, { ...EMPTY_SCOPE, categoryKeys: ["ghost"] }, []);
    expect(where).toEqual({
      userId,
      card: { categoryAssignments: { some: { categoryId: { in: [] } } } },
    });
  });
});

describe("buildExpressionAnswerWhere", () => {
  const userId = "u1";

  it("restricts readiness's denominator to analyzed SHORT-ANSWER rows", () => {
    // MC/TF answers hardcode dimension 'accuracy' and can never produce a
    // clarity/conciseness tag, so counting them in the denominator while only
    // short answers feed the numerator inverts readiness: 100 MC answers plus
    // 3 poor short answers would score ~0.96 instead of ~0.
    const where = buildExpressionAnswerWhere(
      buildQuizAnswerScopeWhere(userId, EMPTY_SCOPE, []),
    );
    expect(where).toEqual({
      userId,
      analysisStatus: "analyzed",
      AND: [{ mode: "short-answer" }],
    });
  });

  it("preserves the set/category scope it is layered on top of", () => {
    const where = buildExpressionAnswerWhere(
      buildQuizAnswerScopeWhere(userId, { ...EMPTY_SCOPE, setIds: ["s1"] }, []),
    );
    expect(where).toMatchObject({ userId, card: { setId: { in: ["s1"] } } });
    expect(where.AND).toEqual([{ mode: "short-answer" }]);
  });

  it("contradicts rather than overwrites a conflicting source scope", () => {
    // Scoped to multiple choice: there is no such thing as an MC expression
    // answer, so the result must be zero rows, not "short answer after all".
    const where = buildExpressionAnswerWhere(
      buildQuizAnswerScopeWhere(userId, { ...EMPTY_SCOPE, source: "quiz-mc" }, []),
    );
    expect(where.mode).toBe("multiple-choice");
    expect(where.AND).toEqual([{ mode: "short-answer" }]);
  });
});

describe("scope URL round-trip", () => {
  it("round-trips a fully populated scope", () => {
    const scope: HistoryScope = {
      setIds: ["s1", "s2"],
      categoryKeys: ["valuation", UNCATEGORIZED_ID],
      cardId: "card9",
      source: "quiz-sa",
    };
    expect(parseScope(new URLSearchParams(serializeScope(scope)))).toEqual(scope);
  });

  it("round-trips the empty scope to no params", () => {
    expect(serializeScope(EMPTY_SCOPE)).toBe("");
    expect(parseScope(new URLSearchParams(""))).toEqual(EMPTY_SCOPE);
  });

  it("ignores unknown params and blank entries", () => {
    expect(parseScope(new URLSearchParams("sets=,,s1&junk=x"))).toEqual({
      ...EMPTY_SCOPE,
      setIds: ["s1"],
    });
  });

  it("treats missing optional fields as undefined, not empty string", () => {
    const parsed = parseScope(new URLSearchParams("sets=s1"));
    expect(parsed.cardId).toBeUndefined();
    expect(parsed.source).toBeUndefined();
  });
});

describe("isConsolidated", () => {
  it("is true only when nothing narrows the view", () => {
    expect(isConsolidated(EMPTY_SCOPE)).toBe(true);
    expect(isConsolidated({ ...EMPTY_SCOPE, setIds: ["s1"] })).toBe(false);
    expect(isConsolidated({ ...EMPTY_SCOPE, categoryKeys: ["v"] })).toBe(false);
    expect(isConsolidated({ ...EMPTY_SCOPE, cardId: "c1" })).toBe(false);
    expect(isConsolidated({ ...EMPTY_SCOPE, source: "review" })).toBe(false);
  });
});
