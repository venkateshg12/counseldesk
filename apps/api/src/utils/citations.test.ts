import { describe, expect, it } from "vitest";
import {
  extractCitations,
  invalidCitationNumbers,
  isNotFoundReply,
} from "./citations.js";
import type { Source } from "../ai/prompts/index.js";

const source = (number: number): Source => ({
  number,
  sectionId: `s${number}`,
  url: `https://site/p#s${number}`,
  heading: `H${number}`,
  content: "text",
});
const sources = [source(1), source(2), source(3)];

describe("extractCitations", () => {
  it("returns cited sources in order of first use, once each", () => {
    const text = "Fees start at $2,500 [2]. Plans are monthly [3][2].";
    expect(extractCitations(text, sources).map((s) => s.number)).toEqual([
      2, 3,
    ]);
  });

  it("understands comma lists", () => {
    expect(
      extractCitations("Both apply [1, 3].", sources).map((s) => s.number),
    ).toEqual([1, 3]);
  });

  it("drops numbers that match no source", () => {
    expect(extractCitations("Made up [7].", sources)).toEqual([]);
    expect(
      invalidCitationNumbers("Made up [7] and real [1].", sources),
    ).toEqual([7]);
  });

  it("returns nothing for an uncited answer", () => {
    expect(extractCitations("No brackets here.", sources)).toEqual([]);
  });
});

describe("isNotFoundReply", () => {
  it("accepts the exact sentence, a curly apostrophe and a follow-up line", () => {
    expect(isNotFoundReply("I couldn't find that on our website.")).toBe(true);
    expect(
      isNotFoundReply(
        "I couldn’t find that on our website.\nWould you like a free consultation?",
      ),
    ).toBe(true);
  });

  it("rejects other answers", () => {
    expect(isNotFoundReply("Our fees start at $2,500 [1].")).toBe(false);
  });
});
