import { describe, it, expect } from "vitest";
import {
  normalizeCategoryName,
  CATEGORY_PALETTE,
  pickDefaultColor,
} from "../../src/lib/cards/categories";

describe("category helpers", () => {
  it("normalizes category names", () => {
    expect(normalizeCategoryName("  Accounting  ")).toBe("accounting");
    expect(normalizeCategoryName("Valuation 101")).toBe("valuation-101");
  });
});

describe("category colors", () => {
  it("has a non-empty palette of hex colors", () => {
    expect(CATEGORY_PALETTE.length).toBeGreaterThanOrEqual(8);
    for (const c of CATEGORY_PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("picks the first unused palette color", () => {
    expect(pickDefaultColor([])).toBe(CATEGORY_PALETTE[0]);
    expect(pickDefaultColor([CATEGORY_PALETTE[0]])).toBe(CATEGORY_PALETTE[1]);
  });

  it("cycles when all palette colors are used", () => {
    const all = [...CATEGORY_PALETTE];
    expect(CATEGORY_PALETTE).toContain(pickDefaultColor(all));
  });
});

import { collectSetCategories } from "../../src/lib/cards/categories";

describe("collectSetCategories", () => {
  it("dedupes meta by normalized name, keeping first display name + color", () => {
    const result = collectSetCategories([], [
      { name: "Accounting", color: "#ef4444" },
      { name: "accounting ", color: "#000000" },
    ]);
    expect(result).toEqual([
      { name: "Accounting", normalizedName: "accounting", color: "#ef4444" },
    ]);
  });

  it("adds card-referenced names missing from meta with a null color", () => {
    // normalizeCategoryName only lowercases/trims and replaces whitespace runs
    // with "-", so "Discount Rate" -> "discount-rate".
    const result = collectSetCategories(
      [{ categoryNames: ["Valuation"] }, { categoryNames: ["valuation", "Discount Rate"] }],
      [{ name: "Accounting", color: "#ef4444" }],
    );
    expect(result).toEqual([
      { name: "Accounting", normalizedName: "accounting", color: "#ef4444" },
      { name: "Valuation", normalizedName: "valuation", color: null },
      { name: "Discount Rate", normalizedName: "discount-rate", color: null },
    ]);
  });

  it("ignores blank names", () => {
    expect(collectSetCategories([{ categoryNames: ["", "  "] }], [{ name: " " }])).toEqual([]);
  });
});

import { filterCardsByCategories, UNCATEGORIZED_ID } from "../../src/lib/cards/categories";

describe("filterCardsByCategories", () => {
  const cards = [
    { id: "a", categoryIds: ["c1"] },
    { id: "b", categoryIds: ["c2"] },
    { id: "c", categoryIds: ["c1", "c2"] },
    { id: "d", categoryIds: [] },
    { id: "e" }, // no categoryIds field at all
  ];

  it("returns all cards when nothing is selected", () => {
    expect(filterCardsByCategories(cards, []).map((c) => c.id)).toEqual([
      "a", "b", "c", "d", "e",
    ]);
  });

  it("ORs across selected categories", () => {
    expect(filterCardsByCategories(cards, ["c1"]).map((c) => c.id)).toEqual(["a", "c"]);
    expect(filterCardsByCategories(cards, ["c1", "c2"]).map((c) => c.id)).toEqual([
      "a", "b", "c",
    ]);
  });

  it("matches uncategorized cards via the sentinel", () => {
    expect(filterCardsByCategories(cards, [UNCATEGORIZED_ID]).map((c) => c.id)).toEqual([
      "d", "e",
    ]);
  });

  it("combines a real category with uncategorized", () => {
    expect(filterCardsByCategories(cards, ["c1", UNCATEGORIZED_ID]).map((c) => c.id)).toEqual([
      "a", "c", "d", "e",
    ]);
  });
});
