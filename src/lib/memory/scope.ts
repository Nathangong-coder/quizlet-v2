import { CATEGORY_PALETTE, UNCATEGORIZED_ID } from "@/lib/cards/categories";

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
  source?: string;
}

export const EMPTY_SCOPE: HistoryScope = { setIds: [], categoryKeys: [] };

export function isConsolidated(scope: HistoryScope): boolean {
  return (
    scope.setIds.length === 0 &&
    scope.categoryKeys.length === 0 &&
    !scope.cardId &&
    !scope.source
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

  if (scope.source) where.source = scope.source;

  // A specific card is the narrowest scope — it subsumes set/category filters.
  if (scope.cardId) {
    where.cardId = scope.cardId;
    return where;
  }

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

  if (Object.keys(card).length > 0) where.card = card;

  return where;
}

export function serializeScope(scope: HistoryScope): string {
  const params = new URLSearchParams();
  if (scope.setIds.length > 0) params.set("sets", scope.setIds.join(","));
  if (scope.categoryKeys.length > 0) params.set("cats", scope.categoryKeys.join(","));
  if (scope.cardId) params.set("card", scope.cardId);
  if (scope.source) params.set("source", scope.source);
  return params.toString();
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function parseScope(params: URLSearchParams): HistoryScope {
  return {
    setIds: parseList(params.get("sets")),
    categoryKeys: parseList(params.get("cats")),
    cardId: params.get("card")?.trim() || undefined,
    source: params.get("source")?.trim() || undefined,
  };
}
