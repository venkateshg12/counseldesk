import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type Page = {
  // URL path on the site: "pages/fees.md" → "/fees", "pages/index.md" → "/".
  path: string;
  title: string;
  markdown: string;
  contentHash: string;
};

// Resolved from this file, so it works from src/ (tsx, tests) and dist/ (built) alike.
const PAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../pages");

const listMarkdownFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listMarkdownFiles(full);
    return entry.name.endsWith(".md") ? [full] : [];
  });
};

const toUrlPath = (file: string, baseDir: string = PAGES_DIR) => {
  const withoutExt = relative(baseDir, file)
    .split(sep)
    .join("/")
    .replace(/\.md$/, "");
  return withoutExt === "index" ? "/" : `/${withoutExt}`;
};

export const loadPages = (dir: string = PAGES_DIR): Page[] =>
  listMarkdownFiles(dir)
    .sort()
    .map((file) => {
      const markdown = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      const title = markdown.match(/^# (.+)$/m)?.[1]?.trim();
      if (!title) throw new Error(`${file} has no "# Title" line`);

      return {
        path: toUrlPath(file, dir),
        title,
        markdown,
        contentHash: createHash("sha256").update(markdown).digest("hex"),
      };
    });
