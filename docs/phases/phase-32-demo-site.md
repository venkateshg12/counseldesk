# Phase 32 — The demo law-firm website

## 1. Goal

Render the 20 markdown pages from `@repo/content` as a real website, statically generated at build
time, where **every heading's `id` is produced by the same slug function the API used for section
anchors**. A citation link like `/fees#dui-fees` then lands exactly on "DUI fees", highlighted.

The site has a header with the main navigation, a footer with the "not legal advice" notice, and
returns 404 for any path that isn't a page.

## 2. What I will understand after this phase

1. Static site generation with `generateStaticParams` and `dynamicParams = false`.
2. How react-markdown maps markdown elements to React components, and how heading ids are injected.
3. Why the heading-id function must be shared with ingestion, and how the "per page, in order" slugger
   keeps duplicates aligned.
4. How the `:target` CSS selector highlights the cited section with no JavaScript.

## 3. Prerequisites

- Phase 31 done.

## 4. Files

```
apps/web/
├── package.json                         (react-markdown)
└── src/
    ├── lib/content.ts                   NEW  server-only access to @repo/content
    ├── components/SiteHeader.tsx        NEW
    ├── components/SiteFooter.tsx        NEW
    ├── components/MarkdownPage.tsx      NEW
    ├── app/page.tsx                     (renders "/")
    ├── app/[...slug]/page.tsx           NEW  every other page
    └── app/not-found.tsx                NEW
```

## 5. Concepts

**Static generation.** `generateStaticParams` returns every path to build; Next renders each to HTML
during `next build`. With `export const dynamicParams = false`, a path not in that list is a 404 instead
of being rendered on demand. The result: fast, cacheable pages, no server needed to serve them, and the
content always matches the commit that built it.

**`/` and `[...slug]`.** The home page is `app/page.tsx`; every other page is caught by
`app/[...slug]/page.tsx` (`/fees` → `slug = ["fees"]`, `/practice-areas/dui` → `["practice-areas",
"dui"]`). Two routes sharing one component is clearer than one optional catch-all with a special case
for the empty slug.

**Heading ids from the shared slugger.** react-markdown turns markdown into React elements and lets
you supply the component for each tag. The heading components call one `createSlugger()` instance per
page, **in document order** — the same thing `splitSections` does in the API (Phase 10). A Server
Component renders exactly once, top to bottom, so the order is deterministic, and the second "Hours" on
a page gets `hours-2` on both sides. The page's intro gets `id="overview"`, matching the API's overview
section.

**`:target`.** When the URL has a fragment, the browser scrolls to the element with that id and applies
`:target` styles to it. One CSS rule highlights the cited heading. (`scroll-margin-top` from Phase 31
keeps it from hiding under a sticky header.)

**react-markdown (flagged dependency).** The spec doesn't name a markdown renderer; react-markdown is a
widely used one that renders to React elements (no `dangerouslySetInnerHTML`) and lets you replace any
element's component — the exact hook needed for heading ids. Raw HTML in markdown is ignored by default,
which is the safe behaviour.

## 6. Steps

### Step 1 — Install

```bash
pnpm --filter web add react-markdown@^10.1.0 server-only@^0.0.1
```

`server-only` is a tiny marker package from the React team: importing it from a module makes the build
fail if that module ever ends up in browser code (Step 2).

### Step 2 — `src/lib/content.ts`

```ts
import "server-only";
import { loadPages, type Page } from "@repo/content";

// Read once per build (Server Components run in Node at build time).
const pages: Page[] = loadPages();

export const allPages = () => pages;

export const findPage = (path: string) =>
  pages.find((page) => page.path === path);

// "/practice-areas/dui" → ["practice-areas", "dui"]
export const toSlug = (path: string) => path.split("/").filter(Boolean);
```

`import "server-only"` makes the build fail if a Client Component ever imports this file — the content
loader reads the filesystem and must never end up in browser JavaScript.

### Step 3 — `src/components/MarkdownPage.tsx`

```tsx
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
  const heading =
    (Tag: "h2" | "h3" | "h4", className: string) =>
    ({ children }: { children?: React.ReactNode }) => (
      <Tag
        id={slug(textOf(children))}
        className={`${className} rounded px-1 target:bg-amber-100`}
      >
        {children}
      </Tag>
    );

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
```

- The API's splitter slugs headings of levels 2–6. This site renders `h2`–`h4`; the firm's pages use
  only `##` and `###` (Phase 10's rule), so the sequences match. If you ever use `####`, it's covered;
  deeper than that, add `h5`/`h6` the same way.
- `id="overview"` on the title: the API's "overview" section is the text before the first `##`, which
  sits right under the title.
- `target:bg-amber-100` is Tailwind's variant for the `:target` selector: the heading a citation points
  at gets a highlight.

### Step 4 — Header, footer, pages

`src/components/SiteHeader.tsx`:

```tsx
import Link from "next/link";

const NAV = [
  { href: "/practice-areas/dui", label: "DUI" },
  { href: "/practice-areas/family-law", label: "Family law" },
  { href: "/practice-areas/personal-injury", label: "Personal injury" },
  { href: "/fees", label: "Fees" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/90 backdrop-blur">
      <nav
        className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4"
        aria-label="Main"
      >
        <Link href="/" className="mr-auto text-lg font-bold text-teal-900">
          Harbor &amp; Vale Law
        </Link>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="text-sm text-stone-700 hover:text-teal-800"
          >
            {item.label}
          </Link>
        ))}
        <Link
          href="/free-consultation"
          className="rounded-full bg-teal-800 px-4 py-2 text-sm font-medium text-white hover:bg-teal-900"
        >
          Free consultation
        </Link>
      </nav>
    </header>
  );
}
```

`src/components/SiteFooter.tsx`:

```tsx
import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-stone-200 bg-white">
      <div className="mx-auto max-w-5xl px-6 py-8 text-sm text-stone-600">
        <p>
          Harbor &amp; Vale Law is a fictional firm created to demonstrate the
          CounselDesk assistant. Nothing on this site is legal advice.
        </p>
        <p className="mt-2">
          <Link href="/privacy" className="underline">
            Privacy and how the website assistant works
          </Link>
        </p>
      </div>
    </footer>
  );
}
```

A wrapper used by both routes — add to `MarkdownPage.tsx` or a new `SitePage.tsx`:

```tsx
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { MarkdownPage } from "./MarkdownPage";
import type { Page } from "@repo/content";

export function SitePage({ page }: { page: Page }) {
  return (
    <>
      <SiteHeader />
      <main>
        <MarkdownPage page={page} />
      </main>
      <SiteFooter />
    </>
  );
}
```

`src/app/page.tsx` (replaces the placeholder):

```tsx
import { notFound } from "next/navigation";
import { findPage } from "@/lib/content";
import { SitePage } from "@/components/SitePage";

export default function Home() {
  const page = findPage("/");
  if (!page) notFound();
  return <SitePage page={page} />;
}
```

`src/app/[...slug]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { allPages, findPage, toSlug } from "@/lib/content";
import { SitePage } from "@/components/SitePage";

// Only the pages that exist; anything else is a 404 rather than rendered on demand.
export const dynamicParams = false;

export function generateStaticParams() {
  return allPages()
    .filter((page) => page.path !== "/")
    .map((page) => ({ slug: toSlug(page.path) }));
}

type Props = { params: Promise<{ slug: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: findPage(`/${slug.join("/")}`)?.title };
}

export default async function ContentPage({ params }: Props) {
  const { slug } = await params;
  const page = findPage(`/${slug.join("/")}`);
  if (!page) notFound();
  return <SitePage page={page} />;
}
```

`params` is a `Promise` in Next 15+ (Next's own docs for v16), hence `await params`.

`src/app/not-found.tsx`:

```tsx
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-24">
        <h1 className="text-3xl font-bold">Page not found</h1>
        <p className="mt-4 text-stone-700">
          <Link href="/" className="underline">
            Back to the home page
          </Link>
        </p>
      </main>
    </>
  );
}
```

## 7. Commit points

1. `feat(web): render firm pages statically from @repo/content`
2. `feat(web): add heading ids from the shared slugger and target highlighting`
3. `feat(web): add header, footer and not-found page`

## 8. Verify

```bash
pnpm --filter web build
# Route list: / and /[...slug] with 19 prerendered paths (●), all static

pnpm --filter web start
open http://localhost:3000/fees#dui-fees        # scrolls to "DUI fees", highlighted
open http://localhost:3000/practice-areas/dui#first-offense-dui
open http://localhost:3000/nope                  # 404 page

# Every anchor the API stored exists on the site (run with the API's database ingested at depth 3):
docker exec counseldesk-postgres psql -U counseldesk -d counseldesk -tAc \
  "SELECT p.path || '#' || s.anchor FROM section s JOIN page p ON p.id = s.\"pageId\"" > /tmp/anchors.txt
for ref in $(cat /tmp/anchors.txt); do
  path=${ref%%#*}; id=${ref#*#}
  curl -s "http://localhost:3000${path}" | grep -q "id=\"${id}\"" || echo "missing on site: $ref"
done
# no output = every section anchor exists as a heading id
```

That last loop is the proof that citations can't land on the wrong place. Phase 38 automates it.

Now update the API's `SITE_URL` to wherever the site runs (locally `http://localhost:3000`, already
the default) and click a citation from a `curl` answer: it should land highlighted.

## 9. Common mistakes

- **Using a different slug library on the site** (or `rehype-slug`). Anchors diverge on punctuation and
  duplicates; citations land at the top of the page.
- **Creating the slugger outside the component** (module level). It would keep counting across pages:
  the second page's "Hours" would become `hours-2`.
- **`dangerouslySetInnerHTML` with a markdown-to-HTML string.** Unnecessary, and unsafe if content ever
  contains HTML.
- **Making content pages Client Components.** They'd ship the markdown renderer to every visitor for no
  reason.

## 10. Interview prep

**Q: How do citation links land on the right paragraph?**
A: The site renders each heading with an id from the same slug function the ingestion pipeline uses for
section anchors, called per page in document order so repeated headings number identically. A check
over every stored anchor confirms each exists on the site, and `:target` highlights it.

**Q: Why static generation?**
A: The content changes only when the repo does; prebuilt HTML is fast, cacheable and needs no server.
`dynamicParams = false` makes unknown paths 404 instead of rendering on demand.

## 11. Resume-safe claim

"Built a statically generated Next.js content site whose heading anchors are generated by the same code
as the RAG ingestion, so every citation deep-links to the exact cited section."

## 12. Definition of done

- [ ] All 20 pages render statically; unknown paths 404
- [ ] The anchor-check loop reports nothing missing
- [ ] A citation URL from the API lands on the highlighted heading
- [ ] Build, typecheck and lint pass
