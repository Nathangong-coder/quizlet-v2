import { describe, it, expect } from "vitest";
import { normalizeCategoryName, parseCategoryInput } from "../../src/lib/cards/categories";

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
