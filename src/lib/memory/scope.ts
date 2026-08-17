import { CATEGORY_PALETTE, UNCATEGORIZED_ID } from "@/lib/cards/categories";
import { toQuizMode, type QuizMode } from "@/lib/quiz/mode";

/**
 * The only quiz mode that can produce expression evidence.
 *
 * MC and TF answers are graded without an AI call and hardcode
 * `dimension: 'accuracy'` (`binaryModeDrafts`), so they can never contribute a
 * clarity or conciseness tag. Counting them in readiness's denominator while
 * only short answers can contribute to its numerator inverts the metric: the
 * more multiple choice a learner does, the more "interview-ready" they look.
 */
const EXPRESSION_QUIZ_MODE: QuizMode = "short-answer";

/**
 * A scope narrows the study-history views (feed, stats, filter options).
 *
 * Empty arrays mean "consolidated" — the zero value is the unscoped view, so
 * there is no separate all-sets code path that can drift from the scoped one.
 *
 * Set and category scope combine as AND between the two dimensions and OR
 * within each: {A, B} x {valuation} means "cards in A or B tagged valuation".
 */
export interface HistoryScope {
  setIds: string[];
  /** Normalized category names; may include UNCATEGORIZED_ID. */
  categoryKeys: string[];
  cardId?: string;
  /**
   * `StudyEvent.source` values to include; empty means every activity.
   *
   * A LIST, not a single value. It was `source?: string` while the control was
   * a row of by-mode chips that could only ever be one-of, which made "how did
   * I do on the two written modes?" — the question a learner actually has —
   * unaskable. Same OR-within-a-dimension semantics as `setIds` and
   * `categoryKeys`, and it AND-combines with them like every other dimension.
   *
   * Serializes to the same `source` URL key as before, comma-joined, so links
   * and saved URLs written against the single-value version still parse.
   */
  sources: string[];
}

export const EMPTY_SCOPE: HistoryScope = { setIds: [], categoryKeys: [], sources: [] };

/**
 * Narrow a scope to a single card — what clicking a term in the activity feed
 * does, and now the ONLY way into card scope. The card `<select>` that used to
 * sit beside it was deleted: it was disabled unless exactly one set happened
 * to be selected, and said so only in a `title` attribute.
 *
 * `setIds` is pinned to that card's own set even though the query does not
 * need it: `buildStudyEventWhere` returns early on `cardId`, subsuming
 * set/category. It is kept for the READER, not the query — the scope line
 * renders a chip per active narrowing, and a lone "Card: X" chip beside two
 * unrelated set chips describes a filter that is not what is being applied.
 *
 * `categoryKeys` are dropped for the mirror-image reason: they are inert
 * against the query once `cardId` is set, so leaving the chips up would
 * advertise a filter that is not filtering. `sources` are kept — they still
 * narrow *within* the card.
 */
export function scopeToCard(
  scope: HistoryScope,
  card: { cardId: string; setId: string },
): HistoryScope {
  return { ...scope, setIds: [card.setId], categoryKeys: [], cardId: card.cardId };
}

export function isConsolidated(scope: HistoryScope): boolean {
  return (
    scope.setIds.length === 0 &&
    scope.categoryKeys.length === 0 &&
    !scope.cardId &&
    scope.sources.length === 0
  );
}

/** One per-set CardCategory row, plus how many cards carry it. */
export interface CategoryRow {
  id: string;
  setId: string;
  name: string;
  normalizedName: string;
  color: string | null;
  cardCount: number;
}

/**
 * A category as it presents above the level of an individual set: the union of
 * every per-set row sharing a normalized name.
 */
export interface CrossSetCategory {
  key: string;
  name: string;
  color: string | null;
  setIds: string[];
  categoryIds: string[];
  cardCount: number;
}

/** Most frequent entry; ties broken by `rank` (lower wins), then insertion order. */
function mostCommon<T>(values: T[], rank: (value: T) => number): T | undefined {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  let best: T | undefined;
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && rank(value) < rank(best as T))) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Collapse per-set category rows into cross-set categories keyed by normalized
 * name. This is what lets a category span sets without a schema migration —
 * "valuation" authored separately in three sets presents as one entry.
 */
export function groupCategoriesByName(rows: CategoryRow[]): CrossSetCategory[] {
  const byKey = new Map<string, CategoryRow[]>();
  for (const row of rows) {
    const existing = byKey.get(row.normalizedName);
    if (existing) existing.push(row);
    else byKey.set(row.normalizedName, [row]);
  }

  const grouped: CrossSetCategory[] = [];
  for (const [key, group] of byKey) {
    const colors = group.map((r) => r.color).filter((c): c is string => c !== null);
    // Unknown colors sort after palette entries but stay deterministic.
    const colorRank = (c: string) => {
      const i = CATEGORY_PALETTE.indexOf(c);
      return i === -1 ? CATEGORY_PALETTE.length : i;
    };

    grouped.push({
      key,
      name: mostCommon(group.map((r) => r.name), () => 0) ?? key,
      color: mostCommon(colors, colorRank) ?? null,
      setIds: Array.from(new Set(group.map((r) => r.setId))),
      categoryIds: group.map((r) => r.id),
      cardCount: group.reduce((sum, r) => sum + r.cardCount, 0),
    });
  }

  return grouped.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The set/category dimensions of a scope, as a Prisma `where` fragment for
 * whatever relation is named `card` on the model being queried. Shared by
 * every scope-aware query builder below so the set/category union semantics
 * (in particular the uncategorized-sentinel OR) are defined exactly once —
 * duplicating this per model is exactly the kind of drift risk a single
 * source of truth is meant to prevent.
 *
 * Exported for `buildLearnerProfile`, whose `CardProgress` query needs the
 * set/category dimensions but not the source/cardId branching the two `where`
 * builders below wrap it in (CardProgress has its own scalar `cardId`, and no
 * source dimension at all).
 */
export function buildCardScopeWhere(
  scope: HistoryScope,
  categoryIds: string[],
): Record<string, unknown> {
  const card: Record<string, unknown> = {};

  if (scope.setIds.length > 0) card.setId = { in: scope.setIds };

  if (scope.categoryKeys.length > 0) {
    const wantUncategorized = scope.categoryKeys.includes(UNCATEGORIZED_ID);
    const hasNamed = scope.categoryKeys.some((k) => k !== UNCATEGORIZED_ID);
    // Note: an empty `in` matches nothing, which is what we want — a stale
    // category key from the URL must not silently widen back to everything.
    const named = { categoryAssignments: { some: { categoryId: { in: categoryIds } } } };
    const uncategorized = { categoryAssignments: { none: {} } };

    if (wantUncategorized && hasNamed) card.OR = [named, uncategorized];
    else if (wantUncategorized) Object.assign(card, uncategorized);
    else Object.assign(card, named);
  }

  return card;
}

/**
 * Prisma `where` for StudyEvent under a scope. Pure, so every combination is
 * testable without a database; the caller resolves `categoryIds` from the
 * scope's category keys first.
 */
export function buildStudyEventWhere(
  userId: string,
  scope: HistoryScope,
  categoryIds: string[],
): Record<string, unknown> {
  const where: Record<string, unknown> = { userId };

  if (scope.sources.length > 0) where.source = { in: scope.sources };

  // A specific card is the narrowest scope — it subsumes set/category filters.
  if (scope.cardId) {
    where.cardId = scope.cardId;
    return where;
  }

  const card = buildCardScopeWhere(scope, categoryIds);
  if (Object.keys(card).length > 0) where.card = card;

  return where;
}

/**
 * Prisma `where` for QuizAnswer under a scope, meant to be embedded as the
 * `quizAnswer: {...}` relation filter when scoping AnswerErrorTag/
 * AnswerKlpResult rows — neither has its own card/set/category relation;
 * both reach one only through their parent QuizAnswer. Mirrors
 * `buildStudyEventWhere`'s exact branching, adapted to QuizAnswer's shape:
 * `mode` stands in for StudyEvent's `source`, and QuizAnswer's own scalar
 * `cardId` is the same narrowest-scope-subsumes-the-rest case.
 *
 * `mode` is NOT the same vocabulary as `source`, however: `HistoryScope.sources`
 * holds `StudySource` values (`quiz-sa`) while `QuizAnswer.mode` holds a
 * `QuizMode` (`short-answer`). Assigning one to the other matches ZERO rows —
 * silently, because a scoped view with no tags reads as "no expression problems
 * at all" rather than as an error. `toQuizMode` is the single bridge.
 */
export function buildQuizAnswerScopeWhere(
  userId: string,
  scope: HistoryScope,
  categoryIds: string[],
): Record<string, unknown> {
  const where: Record<string, unknown> = { userId };

  if (scope.sources.length > 0) {
    // Sources with no quiz mode (`review`, `lesson`) or an unknown string drop
    // out rather than widening. If EVERY selected source drops out the result
    // is an empty `in`, which matches nothing — the same answer the
    // single-value version gave for a review-only scope, and the right one:
    // "review answers, as quiz answers" is a contradiction, not "all of them".
    const modes = scope.sources
      .map((source) => toQuizMode(source))
      .filter((mode): mode is QuizMode => mode !== null);
    where.mode = { in: Array.from(new Set(modes)) };
  }

  if (scope.cardId) {
    where.cardId = scope.cardId;
    return where;
  }

  const card = buildCardScopeWhere(scope, categoryIds);
  if (Object.keys(card).length > 0) where.card = card;

  return where;
}

/** The two `where` fragments a scoped CardCategory query needs. */
export interface CategoryQueryShape {
  /** Filter on CardCategory itself. */
  where: Record<string, unknown>;
  /**
   * Filter on the nested `assignments` relation. `undefined` means every
   * assignment — Prisma treats an undefined relation filter as absent.
   */
  assignmentWhere: { cardId: string } | undefined;
}

/**
 * Scoped query shape for the CardCategory rows the topic profile is built
 * from. Pure so the cardId branch is tested like the other two builders'.
 *
 * `cardId` is the narrowest scope and SUBSUMES set/category, exactly as in
 * `buildStudyEventWhere`/`buildQuizAnswerScopeWhere`. It must narrow BOTH
 * sides: the categories (or a card-scoped request answers with every topic the
 * learner has) and the assignments inside them (or it answers with whole-topic
 * knowledge and KLP counts sitting beside card-scoped tags — numbers from two
 * different populations presented as one profile).
 *
 * The `set: { userId }` guard stays in every branch: CardCategory has no
 * userId of its own and reaches one only through its set.
 */
export function buildCategoryQuery(
  userId: string,
  scope: HistoryScope,
): CategoryQueryShape {
  if (scope.cardId) {
    return {
      where: { set: { userId }, assignments: { some: { cardId: scope.cardId } } },
      assignmentWhere: { cardId: scope.cardId },
    };
  }

  return {
    where: {
      set: { userId, ...(scope.setIds.length > 0 ? { id: { in: scope.setIds } } : {}) },
      ...(scope.categoryKeys.length > 0 ? { normalizedName: { in: scope.categoryKeys } } : {}),
    },
    assignmentWhere: undefined,
  };
}

/**
 * Narrow an already-scoped QuizAnswer `where` to the answers that may carry
 * EXPRESSION evidence: analyzed short-answer rows only. This is readiness's
 * denominator.
 *
 * The mode constraint goes in `AND` rather than overwriting `base.mode`, so a
 * source-scoped request for a non-short-answer mode yields a contradiction
 * (zero rows) instead of quietly widening back to short answer. Two truths
 * that cannot both hold must produce nothing, not the more convenient one.
 */
export function buildExpressionAnswerWhere(
  base: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...base,
    analysisStatus: "analyzed",
    AND: [{ mode: EXPRESSION_QUIZ_MODE }],
  };
}

export function serializeScope(scope: HistoryScope): string {
  const params = new URLSearchParams();
  if (scope.setIds.length > 0) params.set("sets", scope.setIds.join(","));
  if (scope.categoryKeys.length > 0) params.set("cats", scope.categoryKeys.join(","));
  if (scope.cardId) params.set("card", scope.cardId);
  if (scope.sources.length > 0) params.set("source", scope.sources.join(","));
  return params.toString();
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Every key `serializeScope` writes. Kept beside it so the two cannot drift. */
export const SCOPE_PARAM_KEYS = ["sets", "cats", "card", "source"] as const;

/** `?scope=all` — an explicit "show me everything", distinct from no choice. */
export const SCOPE_ALL_PARAM = "scope";

/**
 * Did the URL express a scope at all?
 *
 * Needed because `serializeScope(EMPTY_SCOPE)` is the empty string, so "the
 * learner cleared the scope" and "the learner has not chosen one" are the SAME
 * URL — and they must behave differently: the second gets the saved study
 * scope as a default, the first must not be overridden by it. `?scope=all` is
 * how clearing says so out loud.
 */
export function hasExplicitScope(params: URLSearchParams): boolean {
  if (params.get(SCOPE_ALL_PARAM)) return true;
  return SCOPE_PARAM_KEYS.some((key) => (params.get(key) ?? "").trim().length > 0);
}

export function parseScope(params: URLSearchParams): HistoryScope {
  return {
    setIds: parseList(params.get("sets")),
    categoryKeys: parseList(params.get("cats")),
    cardId: params.get("card")?.trim() || undefined,
    // `parseList` handles the single-value form unchanged, so a URL written by
    // the pre-multi-select version still resolves to exactly that one source.
    sources: parseList(params.get("source")),
  };
}
