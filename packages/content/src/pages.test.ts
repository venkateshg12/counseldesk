import { describe, expect, it } from "vitest";
import { loadPages } from "./loadPages.js";
import { splitSections } from "./splitSections.js";

const pages = loadPages();

describe("firm pages", () => {
  it("has 15–30 pages with unique paths", () => {
    expect(pages.length).toBeGreaterThanOrEqual(15);
    expect(pages.length).toBeLessThanOrEqual(30);
    expect(new Set(pages.map((p) => p.path)).size).toBe(pages.length);
  });

  it("keeps every section within 40–200 words at depth 3", () => {
    for (const p of pages) {
      for (const s of splitSections(p, { depth: 3 })) {
        const words = s.content.split(/\s+/).filter(Boolean).length;
        expect(words, `${p.path}#${s.anchor}`).toBeLessThanOrEqual(200);
      }
    }
  });

  it("states the fee facts the evals depend on", () => {
    const fees = pages.find((p) => p.path === "/fees")!.markdown;
    expect(fees).toContain("$2,500");
    expect(fees).toContain("33%");
    expect(fees).toContain("40%");
  });
});
