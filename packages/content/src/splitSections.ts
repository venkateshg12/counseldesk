import { createHash } from "node:crypto";
import { createSlugger } from "./slug.js";
import type { Page } from "./loadPages.js";

export type SectionDraft = {
  anchor: string;
  heading: string;
  content: string;
  // What is embedded and keyword-indexed: "Page title > Heading\n\ncontent".
  searchText: string;
  position: number;
  contentHash: string;
};

export type SplitOptions = {
  // 2 = split at "##" only (bigger sections); 3 = split at "##" and "###" (smaller).
  depth: 2 | 3;
};

const HEADING = /^(#{2,6}) (.+)$/;

export const splitSections = (
  page: Page,
  { depth }: SplitOptions,
): SectionDraft[] => {
  const slug = createSlugger();
  const drafts: Omit<
    SectionDraft,
    "searchText" | "position" | "contentHash"
  >[] = [];

  // Text before the first split heading belongs to an "overview" section titled like the page.
  let current = {
    anchor: "overview",
    heading: page.title,
    lines: [] as string[],
  };

  const flush = () => {
    const content = current.lines.join("\n").trim();
    if (content)
      drafts.push({
        anchor: current.anchor,
        heading: current.heading,
        content,
      });
  };

  for (const line of page.markdown.split("\n")) {
    if (line.startsWith("# ")) continue; // the page title

    const match = line.match(HEADING);
    if (match) {
      const level = match[1]!.length;
      const text = match[2]!.trim();
      const anchor = slug(text); // every heading is slugged, in order (see slug.ts)

      if (level <= depth) {
        flush();
        current = { anchor, heading: text, lines: [] };
        continue;
      }
      // Deeper headings stay inside the current section as text.
    }
    current.lines.push(line);
  }
  flush();

  return drafts.map((draft, position) => {
    const searchText = `${page.title} > ${draft.heading}\n\n${draft.content}`;
    return {
      ...draft,
      searchText,
      position,
      contentHash: createHash("sha256").update(searchText).digest("hex"),
    };
  });
};
