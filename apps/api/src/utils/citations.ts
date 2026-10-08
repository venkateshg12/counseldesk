import type { Source } from "../ai/prompts/index.js";
import { NOT_FOUND_REPLY } from "../ai/prompts/index.js";

// Matches [1], [12] and [1, 3].
const CITATION = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

const citedNumbers = (text: string) =>
  [...text.matchAll(CITATION)].flatMap((match) =>
    match[1]!.split(",").map((n) => Number(n.trim())),
  );

// Sources the answer actually cites, in order of first use, each once. Numbers that match no
// source are dropped here and counted by invalidCitationNumbers.
export const extractCitations = (text: string, sources: Source[]) => {
  const bySourceNumber = new Map(sources.map((s) => [s.number, s]));
  const seen = new Set<number>();
  const cited: Source[] = [];

  for (const n of citedNumbers(text)) {
    const source = bySourceNumber.get(n);
    if (source && !seen.has(n)) {
      seen.add(n);
      cited.push(source);
    }
  }
  return cited;
};

export const invalidCitationNumbers = (text: string, sources: Source[]) => {
  const valid = new Set(sources.map((s) => s.number));
  return [...new Set(citedNumbers(text))].filter((n) => !valid.has(n));
};

// Tolerates a curly apostrophe and trailing text (the consultation offer on the next line).
export const isNotFoundReply = (text: string) =>
  text.replace(/’/g, "'").trim().startsWith(NOT_FOUND_REPLY.slice(0, -1));
