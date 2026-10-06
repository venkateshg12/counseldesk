import { describe, expect, it } from "vitest";
import { splitSections } from "./splitSections.js";
import type { Page } from "./loadPages.js";

const page = (markdown: string): Page => ({
  path: "/t",
  title: "Fees",
  markdown,
  contentHash: "x",
});

const md = `# Fees

Intro text.

## How we charge

General.

### Flat fees

Flat text.

### Contingency fees

Contingency text.

## Payment plans

Monthly.
`;

describe("splitSections", () => {
  it("splits at ## and ### at depth 3", () => {
    const sections = splitSections(page(md), { depth: 3 });
    expect(sections.map((s) => s.anchor)).toEqual([
      "overview",
      "how-we-charge",
      "flat-fees",
      "contingency-fees",
      "payment-plans",
    ]);
  });

  it("keeps ### text inside its ## section at depth 2", () => {
    const sections = splitSections(page(md), { depth: 2 });
    expect(sections.map((s) => s.anchor)).toEqual([
      "overview",
      "how-we-charge",
      "payment-plans",
    ]);
    expect(sections[1]!.content).toContain("### Flat fees");
    expect(sections[1]!.content).toContain("Contingency text.");
  });

  it("gives a ### heading the same anchor at both depths", () => {
    // The ## that follows it is the 5th heading either way, so its anchor can't depend on depth.
    const d2 = splitSections(page(md), { depth: 2 }).map((s) => s.anchor);
    const d3 = splitSections(page(md), { depth: 3 }).map((s) => s.anchor);
    expect(d2.at(-1)).toBe(d3.at(-1));
  });

  it("loses no text", () => {
    const body = (depth: 2 | 3) =>
      splitSections(page(md), { depth })
        .map((s) => s.content)
        .join("\n");
    for (const word of [
      "Intro",
      "General",
      "Flat text",
      "Contingency text",
      "Monthly",
    ]) {
      expect(body(2)).toContain(word);
      expect(body(3)).toContain(word);
    }
  });

  it("prefixes searchText with page title and heading", () => {
    const [, second] = splitSections(page(md), { depth: 3 });
    expect(second!.searchText.startsWith("Fees > How we charge\n\n")).toBe(
      true,
    );
  });

  it("drops a heading with no text of its own", () => {
    const sections = splitSections(
      page("# T\n\n## Empty\n\n### Child\n\nText."),
      { depth: 3 },
    );
    expect(sections.map((s) => s.anchor)).toEqual(["child"]);
  });
});
