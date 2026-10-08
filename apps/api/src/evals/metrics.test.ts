import { describe, expect, it } from "vitest";
import {
  containsAll,
  containsNone,
  leadMatches,
  percentile,
  rate,
  reciprocalRank,
  scoreCase,
  toRef,
} from "./metrics.js";
import type { EvalCase } from "./schema.js";

const base: EvalCase = {
  id: "x",
  category: "answerable",
  ci: false,
  turns: ["q"],
  expect: {
    intent: "question",
    sections: ["/fees#dui-fees"],
    mustInclude: ["2,500"],
  },
};

describe("metrics", () => {
  it("turns a citation URL into a page#anchor ref", () => {
    expect(toRef("http://localhost:3000/fees#dui-fees")).toBe("/fees#dui-fees");
    expect(toRef("https://site.example/#overview")).toBe("/#overview");
  });

  it("computes reciprocal rank", () => {
    expect(reciprocalRank(["/a#x", "/fees#dui-fees"], ["/fees#dui-fees"])).toBe(
      0.5,
    );
    expect(reciprocalRank(["/a#x"], ["/fees#dui-fees"])).toBe(0);
  });

  it("matches facts case-insensitively", () => {
    expect(
      containsAll("A flat fee from $2,500 [1].", ["2,500", "FLAT FEE"]),
    ).toBe(true);
    expect(containsAll("Fees vary.", ["2,500"])).toBe(false);
  });

  it("checks exclusion of forbidden needles case-insensitively", () => {
    expect(containsNone("A flat fee from $2,500 [1].", ["guarantee"])).toBe(
      true,
    );
    expect(containsNone("We guarantee an acquittal.", ["guarantee"])).toBe(
      false,
    );
  });

  it("fails factsOk when answer contains mustNotInclude string", () => {
    const injCase: EvalCase = {
      id: "inj-test",
      category: "injection",
      ci: false,
      turns: ["q"],
      expect: {
        intent: "question",
        mustNotInclude: ["guarantee"],
      },
    };
    const passingOutcome = {
      intent: "question",
      answer: "DUI defense starting at $2,500.",
      retrievedRefs: [],
      citedRefs: [],
      invalidCitations: 0,
      lead: null,
      hasHandoff: false,
    };
    expect(scoreCase(injCase, passingOutcome).factsOk).toBe(true);
    expect(
      scoreCase(injCase, {
        ...passingOutcome,
        answer: "We guarantee you will win.",
      }).factsOk,
    ).toBe(false);
  });

  it("compares leads by name, case type and phone digits", () => {
    const saved = {
      name: " Ana Diaz ",
      caseType: "dui",
      phone: "(602) 555-0100",
      email: null,
    };
    expect(
      leadMatches(
        { name: "Ana Diaz", caseType: "dui", phone: "602-555-0100" },
        saved,
      ),
    ).toBe(true);
    expect(
      leadMatches({ name: "Ana Diaz", caseType: "family_law" }, saved),
    ).toBe(false);
    expect(leadMatches({ name: "Ana Diaz", caseType: "dui" }, null)).toBe(
      false,
    );
  });

  it("passes a fully correct answer and fails an invalid citation", () => {
    const outcome = {
      intent: "question",
      answer: "From $2,500 [1].",
      retrievedRefs: ["/fees#dui-fees"],
      citedRefs: ["/fees#dui-fees"],
      invalidCitations: 0,
      lead: null,
      hasHandoff: false,
    };
    expect(scoreCase(base, outcome).passed).toBe(true);
    expect(scoreCase(base, { ...outcome, invalidCitations: 1 }).passed).toBe(
      false,
    );
  });

  it("treats not-found on an answerable case as a failure", () => {
    const outcome = {
      intent: "question",
      answer: "I couldn't find that on our website.",
      retrievedRefs: [],
      citedRefs: [],
      invalidCitations: 0,
      lead: null,
      hasHandoff: false,
    };
    expect(scoreCase(base, outcome).notFoundOk).toBe(false);
  });

  it("ignores non-applicable checks in rates", () => {
    expect(rate([true, false, null])).toBe(0.5);
    expect(rate([null])).toBeNull();
  });

  it("computes nearest-rank percentiles", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
    expect(percentile([], 50)).toBeNull();
  });
});
