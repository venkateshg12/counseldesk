import { MarkdownPage } from "./MarkdownPage";
import type { Page } from "@repo/content";

export function SitePage({ page }: { page: Page }) {
  return <MarkdownPage page={page} />;
}
