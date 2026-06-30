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
