import { describe, it, expect } from "vitest";
import {
  normalizeCategoryName,
  parseCategoryInput,
  CATEGORY_PALETTE,
  pickDefaultColor,
} from "../../src/lib/cards/categories";

describe("category helpers", () => {
  it("normalizes category names", () => {
    expect(normalizeCategoryName("  Accounting  ")).toBe("accounting");
    expect(normalizeCategoryName("Valuation 101")).toBe("valuation-101");
  });

  it("parses category input", () => {
    expect(parseCategoryInput("accounting, valuation, talking")).toEqual([
      "accounting",
      "valuation",
      "talking",
    ]);
    expect(parseCategoryInput("accounting, accounting, valuation")).toEqual([
      "accounting",
      "valuation",
    ]);
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
