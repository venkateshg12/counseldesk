import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "./rrf.js";

const ids = (fused: { id: string }[]) => fused.map((f) => f.id);

describe("reciprocalRankFusion", () => {
  it("keeps the order of a single list", () => {
    expect(ids(reciprocalRankFusion([["a", "b", "c"]], 60))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("ranks an item found by both lists above items found by one", () => {
    // "b" is second in both; "a" and "c" are each first in only one.
    const fused = reciprocalRankFusion(
      [
        ["a", "b"],
        ["c", "b"],
      ],
      60,
    );
    expect(fused[0]!.id).toBe("b");
  });

  it("computes 1/(k+rank) per list", () => {
    const [top] = reciprocalRankFusion([["a"], ["a"]], 60);
    expect(top!.score).toBeCloseTo(2 / 61);
  });

  it("includes items that appear in only one list", () => {
    expect(ids(reciprocalRankFusion([["a"], ["b"]], 60)).sort()).toEqual([
      "a",
      "b",
    ]);
  });

  it("breaks ties by id so results are deterministic", () => {
    expect(ids(reciprocalRankFusion([["b"], ["a"]], 60))).toEqual(["a", "b"]);
  });

  it("lets a small k favour the top of each list", () => {
    // x: 1st in list 1 only. y: 3rd in both lists.
    const lists = [
      ["x", "p", "y"],
      ["q", "r", "y"],
    ];
    const position = (k: number, id: string) =>
      ids(reciprocalRankFusion(lists, k)).indexOf(id);

    expect(position(0, "x")).toBeLessThan(position(0, "y")); // 1/1 beats 1/3 + 1/3
    expect(position(60, "y")).toBeLessThan(position(60, "x")); // 2/63 beats 1/61
  });

  it("handles empty input", () => {
    expect(reciprocalRankFusion([], 60)).toEqual([]);
    expect(reciprocalRankFusion([[], []], 60)).toEqual([]);
  });
});
