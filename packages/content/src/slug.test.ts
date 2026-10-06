import { describe, expect, it } from "vitest";
import { createSlugger, slugify } from "./slug.js";

describe("slugify", () => {
  it("lowercases and joins words with dashes", () => {
    expect(slugify("Fees for DUI cases")).toBe("fees-for-dui-cases");
  });

  it("drops punctuation and accents, spells out &", () => {
    expect(slugify("Wills, Trusts & Probate — Overview")).toBe(
      "wills-trusts-and-probate-overview",
    );
    expect(slugify("Mediación")).toBe("mediacion");
  });
});

describe("createSlugger", () => {
  it("numbers repeated headings within one page", () => {
    const slug = createSlugger();
    expect([slug("Hours"), slug("Hours"), slug("Hours")]).toEqual([
      "hours",
      "hours-2",
      "hours-3",
    ]);
  });

  it("starts fresh for each page", () => {
    expect(createSlugger()("Hours")).toBe("hours");
    expect(createSlugger()("Hours")).toBe("hours");
  });
});
