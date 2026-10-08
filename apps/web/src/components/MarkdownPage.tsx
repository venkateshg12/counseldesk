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

export function MarkdownPage({ page }: { page: Page }) {
  // One slugger per page, called for every heading in order — the same contract as the API's splitter.
  const slug = createSlugger();
  const heading = (Tag: "h2" | "h3" | "h4", className: string) => {
    function HeadingComponent({ children }: { children?: React.ReactNode }) {
      return (
        <Tag
          id={slug(textOf(children))}
          className={`${className} rounded px-1 target:bg-amber-100`}
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
    h2: heading("h2", "mt-10 text-2xl font-semibold"),
    h3: heading("h3", "mt-6 text-xl font-semibold"),
    h4: heading("h4", "mt-4 text-lg font-semibold"),
    p: ({ children }) => (
      <p className="mt-3 leading-7 text-stone-700">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="mt-3 list-disc space-y-1 pl-6 text-stone-700">
        {children}
      </ul>
    ),
    a: ({ href, children }) => (
      <a href={href} className="text-teal-800 underline underline-offset-2">
        {children}
      </a>
    ),
  };

  return (
    <article className="mx-auto max-w-3xl px-6 py-12">
      <h1 id="overview" className="text-4xl font-bold tracking-tight">
        {page.title}
      </h1>
      <Markdown components={components}>{page.markdown}</Markdown>
    </article>
  );
}
