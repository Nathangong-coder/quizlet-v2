import { describe, it, expect } from "vitest";
import {
  EMPTY_SCOPE,
  groupCategoriesByName,
  buildStudyEventWhere,
  buildQuizAnswerScopeWhere,
  buildExpressionAnswerWhere,
  buildCategoryQuery,
  serializeScope,
  parseScope,
  isConsolidated,
  scopeToCard,
  hasExplicitScope,
  SCOPE_PARAM_KEYS,
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
    const where = buildStudyEventWhere(userId, { ...EMPTY_SCOPE, sources: ["quiz-sa"] }, []);
    expect(where).toEqual({ userId, source: { in: ["quiz-sa"] } });
  });

  it("ORs within the source dimension, so two modes select both", () => {
    // The whole reason `source` became a list: "how did I do on the two
    // written modes?" was unaskable while it was one-of.
    const where = buildStudyEventWhere(
      userId,
      { ...EMPTY_SCOPE, sources: ["quiz-sa", "quiz-tf"] },
      [],
    );
    expect(where).toEqual({ userId, source: { in: ["quiz-sa", "quiz-tf"] } });
  });

  it("ANDs source against the card dimensions rather than replacing them", () => {
    const where = buildStudyEventWhere(
      userId,
      { ...EMPTY_SCOPE, setIds: ["s1"], sources: ["review"] },
      [],
    );
    expect(where).toEqual({
      userId,
      source: { in: ["review"] },
      card: { setId: { in: ["s1"] } },
    });
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
    const where = buildQuizAnswerScopeWhere(userId, { ...EMPTY_SCOPE, sources: ["quiz-sa"] }, []);
    expect(where).toEqual({ userId, mode: { in: ["short-answer"] } });
  });

  it("translates every quiz source, not just short answer", () => {
    expect(buildQuizAnswerScopeWhere(userId, { ...EMPTY_SCOPE, sources: ["quiz-mc"] }, []))
      .toEqual({ userId, mode: { in: ["multiple-choice"] } });
    expect(buildQuizAnswerScopeWhere(userId, { ...EMPTY_SCOPE, sources: ["quiz-tf"] }, []))
      .toEqual({ userId, mode: { in: ["true-false"] } });
    expect(buildQuizAnswerScopeWhere(userId, { ...EMPTY_SCOPE, sources: ["matching"] }, []))
      .toEqual({ userId, mode: { in: ["matching"] } });
  });

  it("matches nothing for a source that no QuizAnswer can carry", () => {
    // 'review' is a StudySource with no quiz mode. Dropping the filter would
    // silently widen the query back to every mode.
    const where = buildQuizAnswerScopeWhere(userId, { ...EMPTY_SCOPE, sources: ["review"] }, []);
    expect(where).toEqual({ userId, mode: { in: [] } });
  });

  it("keeps the quiz modes when a mixed selection also names a non-quiz source", () => {
    // 'review' has no QuizMode. It must drop out WITHOUT taking the modes that
    // do translate with it, and without widening to every mode.
    const where = buildQuizAnswerScopeWhere(
      userId,
      { ...EMPTY_SCOPE, sources: ["review", "quiz-mc"] },
      [],
    );
    expect(where).toEqual({ userId, mode: { in: ["multiple-choice"] } });
  });

  it("de-duplicates modes that two sources map onto", () => {
    const where = buildQuizAnswerScopeWhere(
      userId,
      { ...EMPTY_SCOPE, sources: ["quiz-sa", "quiz-sa"] },
      [],
    );
    expect(where).toEqual({ userId, mode: { in: ["short-answer"] } });
  });

  it("matches nothing when a category scope resolves to no ids", () => {
    const where = buildQuizAnswerScopeWhere(userId, { ...EMPTY_SCOPE, categoryKeys: ["ghost"] }, []);
    expect(where).toEqual({
      userId,
      card: { categoryAssignments: { some: { categoryId: { in: [] } } } },
    });
  });
});

describe("buildCategoryQuery", () => {
  const userId = "u1";

  it("scopes to the user's sets with no other scope", () => {
    expect(buildCategoryQuery(userId, EMPTY_SCOPE)).toEqual({
      where: { set: { userId } },
      assignmentWhere: undefined,
    });
  });

  it("honours set and category scope", () => {
    expect(
      buildCategoryQuery(userId, { ...EMPTY_SCOPE, setIds: ["s1"], categoryKeys: ["valuation"] }),
    ).toEqual({
      where: { set: { userId, id: { in: ["s1"] } }, normalizedName: { in: ["valuation"] } },
      assignmentWhere: undefined,
    });
  });

  it("narrows the ASSIGNMENTS to the scoped card", () => {
    // Without this, a card-scoped request returned whole-topic knowledge and
    // KLP counts beside card-scoped tags — two different populations presented
    // as one profile.
    const q = buildCategoryQuery(userId, { ...EMPTY_SCOPE, cardId: "card9" });
    expect(q.assignmentWhere).toEqual({ cardId: "card9" });
  });

  it("narrows the CATEGORIES to those the scoped card carries", () => {
    const q = buildCategoryQuery(userId, { ...EMPTY_SCOPE, cardId: "card9" });
    expect(q.where).toEqual({
      set: { userId },
      assignments: { some: { cardId: "card9" } },
    });
  });

  it("lets cardId subsume set and category scope, as the other builders do", () => {
    const q = buildCategoryQuery(userId, {
      setIds: ["s1"], categoryKeys: ["valuation"], cardId: "card9", sources: [],
    });
    expect(q.where).toEqual({
      set: { userId },
      assignments: { some: { cardId: "card9" } },
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
      buildQuizAnswerScopeWhere(userId, { ...EMPTY_SCOPE, sources: ["quiz-mc"] }, []),
    );
    expect(where.mode).toEqual({ in: ["multiple-choice"] });
    expect(where.AND).toEqual([{ mode: "short-answer" }]);
  });
});

describe("scope URL round-trip", () => {
  it("round-trips a fully populated scope", () => {
    const scope: HistoryScope = {
      setIds: ["s1", "s2"],
      categoryKeys: ["valuation", UNCATEGORIZED_ID],
      cardId: "card9",
      sources: ["quiz-sa", "review"],
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
    expect(parsed.sources).toEqual([]);
  });

  it("still parses a single-value `source` written by the old URL format", () => {
    // Links and bookmarks predate `sources` being a list; comma-splitting a
    // lone value has to yield exactly that one source, not drop it.
    expect(parseScope(new URLSearchParams("source=quiz-sa")).sources).toEqual(["quiz-sa"]);
  });
});

describe("scopeToCard", () => {
  const card = { cardId: "c1", setId: "s1" };

  it("pins the card's own set, not whatever was selected", () => {
    // The scope line renders one chip per active narrowing, so a "Card: X"
    // chip sitting beside two unrelated set chips would describe a filter
    // that is not the one being applied — cardId subsumes them in
    // buildStudyEventWhere.
    const scope = scopeToCard({ ...EMPTY_SCOPE, setIds: ["s7", "s9"] }, card);
    expect(scope.setIds).toEqual(["s1"]);
    expect(scope.cardId).toBe("c1");
  });

  it("drops category keys, which are inert once a card is chosen", () => {
    // buildStudyEventWhere returns early on cardId, so the categories would
    // filter nothing while their chips still claimed to.
    const scope = scopeToCard({ ...EMPTY_SCOPE, categoryKeys: ["valuation"] }, card);
    expect(scope.categoryKeys).toEqual([]);
  });

  it("keeps the source filter, which still narrows within the card", () => {
    const scope = scopeToCard({ ...EMPTY_SCOPE, sources: ["review"] }, card);
    expect(scope.sources).toEqual(["review"]);
  });

  it("re-targets cleanly when a different card is picked", () => {
    const first = scopeToCard(EMPTY_SCOPE, card);
    const second = scopeToCard(first, { cardId: "c2", setId: "s2" });
    expect(second).toEqual({ ...EMPTY_SCOPE, setIds: ["s2"], cardId: "c2" });
  });

  it("narrows the study-event query to exactly that card", () => {
    // The whole point: one click from the feed produces a scope the forget
    // verb can act on.
    const scope = scopeToCard({ ...EMPTY_SCOPE, setIds: ["s7"] }, card);
    expect(buildStudyEventWhere("u1", scope, [])).toEqual({ userId: "u1", cardId: "c1" });
  });
});

describe("isConsolidated", () => {
  it("is true only when nothing narrows the view", () => {
    expect(isConsolidated(EMPTY_SCOPE)).toBe(true);
    expect(isConsolidated({ ...EMPTY_SCOPE, setIds: ["s1"] })).toBe(false);
    expect(isConsolidated({ ...EMPTY_SCOPE, categoryKeys: ["v"] })).toBe(false);
    expect(isConsolidated({ ...EMPTY_SCOPE, cardId: "c1" })).toBe(false);
    expect(isConsolidated({ ...EMPTY_SCOPE, sources: ["review"] })).toBe(false);
  });
});

describe('hasExplicitScope (Spec 3C §2)', () => {
  const q = (s: string) => new URLSearchParams(s)

  it('is false for a bare URL — no instruction, so the saved default applies', () => {
    expect(hasExplicitScope(q(''))).toBe(false)
  })

  it('is true for every key serializeScope writes', () => {
    for (const key of SCOPE_PARAM_KEYS) {
      expect(hasExplicitScope(q(`${key}=x`))).toBe(true)
    }
  })

  it('is true for the explicit "everything" marker', () => {
    // `serializeScope(EMPTY_SCOPE)` is the empty string, so without this
    // marker "I cleared the scope" and "I have not chosen one" are the same
    // URL — and the saved default must override only the second.
    expect(hasExplicitScope(q('scope=all'))).toBe(true)
  })

  it('ignores a present-but-blank key', () => {
    expect(hasExplicitScope(q('sets='))).toBe(false)
    expect(hasExplicitScope(q('sets=%20'))).toBe(false)
  })

  it('covers exactly the keys serializeScope emits', () => {
    // Drift guard: a new scope dimension that serializes but is missing here
    // would be silently overridden by the saved default.
    const emitted = new URLSearchParams(
      serializeScope({ setIds: ['a'], categoryKeys: ['b'], cardId: 'c', sources: ['review'] }),
    )
    expect([...emitted.keys()].sort()).toEqual([...SCOPE_PARAM_KEYS].sort())
  })
})
