export function normalizeCategoryName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

export const CATEGORY_PALETTE = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#a855f7", // purple
  "#ec4899", // pink
  "#78716c", // stone
];

export function pickDefaultColor(existingColors: string[]): string {
  const used = new Set(existingColors);
  const free = CATEGORY_PALETTE.find((c) => !used.has(c));
  return free ?? CATEGORY_PALETTE[existingColors.length % CATEGORY_PALETTE.length];
}

export const UNCATEGORIZED_ID = "__uncategorized__";

export function filterCardsByCategories<T extends { categoryIds?: string[] }>(
  cards: T[],
  selectedCategoryIds: string[],
): T[] {
  if (!selectedCategoryIds || selectedCategoryIds.length === 0) return cards;
  const wantUncategorized = selectedCategoryIds.includes(UNCATEGORIZED_ID);
  const realIds = selectedCategoryIds.filter((id) => id !== UNCATEGORIZED_ID);
  return cards.filter((card) => {
    const ids = card.categoryIds ?? [];
    if (wantUncategorized && ids.length === 0) return true;
    return realIds.some((id) => ids.includes(id));
  });
}

export interface CategoryMetaInput {
  name: string;
  color?: string | null;
}

export interface CollectedCategory {
  name: string;
  normalizedName: string;
  color: string | null;
}

export function collectSetCategories(
  cards: { categoryNames?: string[] }[],
  meta: CategoryMetaInput[] = [],
): CollectedCategory[] {
  const byNormalized = new Map<string, CollectedCategory>();

  const add = (rawName: string, color: string | null) => {
    const name = rawName.trim();
    if (!name) return;
    const normalizedName = normalizeCategoryName(name);
    if (!normalizedName) return;
    if (!byNormalized.has(normalizedName)) {
      byNormalized.set(normalizedName, { name, normalizedName, color });
    }
  };

  // Explicit meta wins (display name + chosen color).
  for (const m of meta) add(m.name, m.color ?? null);

  // Defensive: ensure names referenced by cards exist even if meta missed them.
  for (const card of cards) {
    for (const n of card.categoryNames ?? []) add(n, null);
  }

  return Array.from(byNormalized.values());
}
