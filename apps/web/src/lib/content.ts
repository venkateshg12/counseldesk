import "server-only";
import { loadPages, type Page } from "@repo/content";

// Read once per build (Server Components run in Node at build time).
const pages: Page[] = loadPages();

export const allPages = () => pages;

export const findPage = (path: string) =>
  pages.find((page) => page.path === path);

// "/practice-areas/dui" → ["practice-areas", "dui"]
export const toSlug = (path: string) => path.split("/").filter(Boolean);
