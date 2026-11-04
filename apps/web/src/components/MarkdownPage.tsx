import Markdown, { type Components } from "react-markdown";
import { createSlugger } from "@repo/content";
import type { Page } from "@repo/content";

// The text inside a heading, e.g. "Fees for **DUI** cases" → "Fees for DUI cases".
const textOf = (node: React.ReactNode): string =>
  typeof node === "string" || typeof node === "number"
    ? String(node)
    : Array.isArray(node)
      ? node.map(textOf).join("")
      : node && typeof node === "object" && "props" in node
        ? textOf((node.props as { children?: React.ReactNode }).children)
        : "";

export function MarkdownPage({
  page,
  showTitle = true,
}: {
  page: Page;
  // The home page renders its title in a hero instead.
  showTitle?: boolean;
}) {
  // One slugger per page, called for every heading in order — the same contract as the API's splitter.
  const slug = createSlugger();
  const heading = (Tag: "h2" | "h3" | "h4", className: string) => {
    function HeadingComponent({ children }: { children?: React.ReactNode }) {
      return (
        <Tag
          id={slug(textOf(children))}
          className={`${className} -mx-1 rounded px-1 text-ink target:bg-brand/20`}
        >
          {children}
        </Tag>
      );
    }
    HeadingComponent.displayName = `Heading_${Tag}`;
    return HeadingComponent;
  };

  const components: Components = {
    h1: () => null, // the title is rendered by the page itself
    h2: heading("h2", "mt-14 text-3xl font-normal tracking-[-0.01em]"),
    h3: heading("h3", "mt-8 text-2xl font-normal tracking-[-0.01em]"),
    h4: heading("h4", "mt-6 text-xl font-normal"),
    p: ({ children }) => (
      <p className="mt-4 text-lg leading-[1.45] text-body">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="mt-4 list-disc space-y-2 pl-6 text-lg leading-[1.45] text-body marker:text-link">
        {children}
      </ul>
    ),
    strong: ({ children }) => (
      <strong className="font-normal text-ink">{children}</strong>
    ),
    a: ({ href, children }) => (
      <a
        href={href}
        className="text-link underline decoration-link/40 underline-offset-4 transition-colors hover:decoration-link"
      >
        {children}
      </a>
    ),
  };

  return (
    <article
      className={
        showTitle
          ? "mx-auto max-w-3xl px-6 py-14"
          : "mx-auto max-w-[1200px] px-6 py-14 [&>*]:max-w-3xl"
      }
    >
      {showTitle ? (
        <h1
          id="overview"
          className="text-5xl font-normal leading-[1.1] tracking-[-0.01em] text-ink"
        >
          {page.title}
        </h1>
      ) : null}
      <Markdown components={components}>{page.markdown}</Markdown>
    </article>
  );
}
