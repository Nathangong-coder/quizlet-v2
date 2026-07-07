export function normalizeCategoryName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

export function parseCategoryInput(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    )
  );
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
