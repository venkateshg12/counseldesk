import { MarkdownPage } from "./MarkdownPage";
import type { Page } from "@repo/content";

export function SitePage({
  page,
  showTitle,
}: {
  page: Page;
  showTitle?: boolean;
}) {
  return <MarkdownPage page={page} showTitle={showTitle} />;
}
