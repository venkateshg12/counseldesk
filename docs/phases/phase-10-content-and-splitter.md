# Phase 10 — The firm's content and the heading splitter

## 1. Goal

Create the made-up law firm the assistant knows about, as 20 markdown pages, and the code that turns
a page into sections. Both live in a new shared package, `@repo/content`, because two apps need them:

- the API (Phase 11) reads the pages, splits them and stores sections with embeddings;
- the website (Phase 32) renders the same files, with heading anchors made by the **same** function,
  so a citation link `#fees-for-dui-cases` lands on the right heading.

This is also the first phase with unit tests. The splitter and the slug function are pure functions
— input in, output out — the easiest code there is to test, and the place where a subtle bug
(duplicate anchors, lost text) would silently damage every answer.

## 2. What I will understand after this phase

1. Why chunking decides retrieval quality, and why "split by heading" is a good first strategy for
   website content.
2. How a `depth` parameter (split at `##` only, or at `##` and `###`) gives a real "section size"
   experiment for Phase 23.
3. Why the slug function must be shared between ingestion and rendering.
4. How to write focused unit tests with Vitest, and what to test in a splitter.
5. Why the content is written against a fact sheet — the eval suite depends on those facts.

## 3. Prerequisites

- Phase 09 done (not strictly required; this phase doesn't touch the API).

## 4. Files

```
packages/content/                       NEW package @repo/content
├── package.json
├── tsconfig.json
├── eslint.config.js
├── pages/                              the firm's website, one .md file per page
│   ├── index.md                        → /
│   ├── about.md                        → /about
│   ├── … (20 files, listed in Step 2)
└── src/
    ├── index.ts
    ├── slug.ts
    ├── slug.test.ts
    ├── loadPages.ts
    ├── splitSections.ts
    └── splitSections.test.ts
```

## 5. Concepts

**Chunking.** Retrieval returns chunks, not pages. Too big, and a chunk about five topics matches
everything weakly, and the model gets a lot of irrelevant text. Too small, and a sentence loses the
context that made it meaningful ("It's free" — what is?). Website pages are already organised by
their authors into headings, each about one thing, so the heading structure is the natural first
chunk boundary. No token counting, no overlap windows: those are for unstructured text like PDFs.

**The `depth` knob.** `depth: 2` splits at `##` headings (bigger sections, each including its `###`
subsections). `depth: 3` also splits at `###` (smaller sections). Every chunk boundary is still a real
heading, so every chunk still has a real anchor on the website. That's the "section size" variable
Phase 23 changes, while keeping citations valid.

**Context in the indexed text.** A section's body often doesn't repeat what it's about: under
"Payment plans", the text "We accept monthly payments" never says "DUI". So the text that gets
embedded and keyword-indexed is `Page title > Section heading` followed by the body. That one line of
context noticeably helps both searches.

**Slugs and the shared slugger.** A heading becomes an anchor by lowercasing, dropping punctuation and
joining words with dashes: "Fees for DUI cases" → `fees-for-dui-cases`. Two identical headings on one
page get `-2`, `-3`. If the API and the website each wrote their own version, one small difference
(say, how `&` is handled) would make every citation to that heading land at the top of the page
instead. One function in one package removes that class of bug.

**Content hashing.** Each page's markdown is hashed (SHA-256). Ingestion compares hashes and skips
unchanged pages — no re-embedding, no API calls. That's what makes ingestion cheap to re-run and safe
to resume after a failure (Phase 11).

**A fact sheet.** Every fact the golden dataset (Phase 21) asks about must exist in the pages, in one
place, worded clearly — and some facts must deliberately **not** exist (the firm doesn't do
immigration law) so "I couldn't find that" can be tested. Writing pages against a fact sheet makes
the eval suite's expectations checkable.

## 6. Steps

### Step 1 — The package

`packages/content/package.json`:

```json
{
  "name": "@repo/content",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "@types/node": "^22.20.5",
    "eslint": "^9.39.5",
    "typescript": "5.9.3",
    "vitest": "^5.0.3"
  }
}
```

`tsconfig.json` — same as `packages/types`, plus Node types (the loader reads files), and tests
excluded from the build:

```json
{
  "extends": "@repo/typescript-config/base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
}
```

`eslint.config.js` — the same two lines as the other packages. Then:

```bash
pnpm install
```

### Step 2 — Write the firm (fact sheet, then pages)

The firm is fictional: **Harbor & Vale Law**, Phoenix, Arizona. Facts the pages must state
(each in exactly one page, in plain words):

| Fact                                                                                                                                   | Page                   |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Free first consultation, 30 minutes, in person or by video                                                                             | `/free-consultation`   |
| Office hours Mon–Fri 8:00–18:00, Sat 9:00–13:00, closed Sunday                                                                         | `/contact`             |
| Phoenix office: 400 W Washington St, Suite 1200                                                                                        | `/locations/phoenix`   |
| Mesa office: 55 N Center St, Suite 300                                                                                                 | `/locations/mesa`      |
| Phone (602) 555-0142; consultations also in Spanish                                                                                    | `/contact`             |
| First-offense misdemeanor DUI: flat fee from $2,500                                                                                    | `/fees`                |
| Extreme DUI and felony DUI quoted after consultation                                                                                   | `/fees`                |
| Personal injury: contingency fee, 33% before a lawsuit is filed, 40% after                                                             | `/fees`                |
| Payment plans for criminal and DUI cases, monthly                                                                                      | `/fees`                |
| Practice areas: DUI, criminal defense, family law, personal injury, estate planning                                                    | `/` and each area page |
| Licensed in Arizona only; cases outside Arizona are referred out                                                                       | `/about`               |
| Does **not** handle immigration, bankruptcy, tax, or patents (referrals offered)                                                       | `/faq`                 |
| Attorneys: Elena Ruiz (DUI and criminal defense, 14 years), Marcus Chen (family law), Priya Nair (personal injury and estate planning) | `/attorneys/*`         |
| Arizona DUI: you have 15 days after an MVD suspension notice to request a hearing                                                      | `/faq/dui`             |
| Divorce in Arizona has a 60-day waiting period after service                                                                           | `/faq/divorce`         |

The 20 pages and their `##` / `###` headings (file path → URL path):

```
index.md                          /                         ## How we can help, ## Why clients choose us, ## Start with a free consultation
about.md                          /about                    ## Our story, ## Where we practise (Arizona only), ## Our values
attorneys/elena-ruiz.md           /attorneys/elena-ruiz     ## Practice focus, ## Experience, ## Education
attorneys/marcus-chen.md          /attorneys/marcus-chen    ## Practice focus, ## Experience, ## Education
attorneys/priya-nair.md           /attorneys/priya-nair     ## Practice focus, ## Experience, ## Education
practice-areas/dui.md             /practice-areas/dui       ## What we handle (### First-offense DUI, ### Extreme DUI, ### Felony DUI), ## How a DUI case works, ## Protecting your licence
practice-areas/criminal-defense.md                          ## Charges we defend, ## Your first steps after an arrest, ## How we build a defence
practice-areas/family-law.md                                ## Divorce, ## Child custody, ## Child support, ## Mediation
practice-areas/personal-injury.md                           ## Cases we take, ## What happens after an accident, ## How compensation works
practice-areas/estate-planning.md                           ## Wills, ## Trusts, ## Powers of attorney
fees.md                           /fees                     ## How we charge (### Flat fees, ### Contingency fees, ### Hourly work), ## DUI fees, ## Personal injury fees, ## Payment plans
free-consultation.md              /free-consultation        ## What the consultation includes, ## How to book, ## What to bring
faq.md                            /faq                      ## General questions, ## Cases we don't handle, ## Working with us
faq/dui.md                        /faq/dui                  ## After an arrest, ## The MVD hearing deadline, ## Ignition interlock
faq/divorce.md                    /faq/divorce              ## Filing, ## The waiting period, ## Property and debts
locations/phoenix.md              /locations/phoenix        ## Address and parking, ## Hours
locations/mesa.md                 /locations/mesa           ## Address and parking, ## Hours
contact.md                        /contact                  ## Call or email, ## Office hours, ## Languages
what-to-expect.md                 /what-to-expect           ## Your first meeting, ## Communication, ## Timelines
privacy.md                        /privacy                  ## What we collect, ## How the website assistant works, ## Not legal advice
```

Rules for writing them:

- First line `# Page title`. One `#` per page.
- Each section 40–200 words. Short paragraphs. No tables, images or HTML.
- Every fact from the sheet appears once, as a plain sentence.
- Never give legal advice ("you will be found not guilty"); describe the process and the firm's
  services. The site is the assistant's only source, so its tone becomes the assistant's tone.
- `privacy.md` must say the assistant gives general information, not legal advice. Phase 17's
  disclaimer quotes it.

Two complete pages, to show the format:

`pages/fees.md`:

```markdown
# Fees and payment

## How we charge

We explain our fee before any work starts, in writing. How we charge depends on the type of case.

### Flat fees

Most criminal and DUI cases are handled for a flat fee. A flat fee covers the work described in your
agreement, however many hours it takes, so the price does not grow as the case goes on.

### Contingency fees

Personal injury cases are handled on contingency. You pay no fee unless we recover money for you.

### Hourly work

Family law and estate planning matters are usually billed by the hour. We give you an estimate at
the start and update it if the case changes.

## DUI fees

Representation for a first-offense misdemeanor DUI starts at a flat fee of $2,500. Extreme DUI and
felony DUI cases are quoted after a free consultation, because the work involved varies widely.

## Personal injury fees

Our contingency fee is 33% of the recovery if your case settles before a lawsuit is filed, and 40%
if a lawsuit is filed. Case costs are explained in your agreement.

## Payment plans

For criminal and DUI cases we offer monthly payment plans. Ask about them during your free
consultation.
```

`pages/faq.md` (only the section the "unanswerable / out of scope" tests depend on is shown; write
the other two):

```markdown
# Frequently asked questions

## Cases we don't handle

We do not handle immigration, bankruptcy, tax, or patent matters. If you need help with one of these,
we are happy to refer you to another firm.
```

Writing 20 pages by hand is the slowest step of this phase. Drafting them with an AI assistant from
the fact sheet and outline, then **editing every page yourself** against the sheet, is fine — the
pages are test fixtures, and what matters is that every fact is present, correct and in one place.
Read each page aloud once; anything that sounds like legal advice gets rewritten.

### Step 3 — `src/slug.ts`

```ts
// "Fees for DUI cases" → "fees-for-dui-cases". Used by ingestion (anchors) and the website (heading
// ids), so both always produce the same anchor for the same heading.
export const slugify = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // accents: "é" → "e"
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-");

// Per-page: the second "Hours" heading becomes "hours-2", the third "hours-3".
export const createSlugger = () => {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = slugify(text) || "section";
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };
};
```

A slugger is created once per page and called for every heading **in order**, including headings
that don't start a section at the current depth. That way a `###` heading has the same anchor whether
you split at depth 2 or 3, and the website (which renders every heading) agrees with both.

### Step 4 — `src/loadPages.ts`

```ts
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type Page = {
  // URL path on the site: "pages/fees.md" → "/fees", "pages/index.md" → "/".
  path: string;
  title: string;
  markdown: string;
  contentHash: string;
};

// Resolved from this file, so it works from src/ (tsx, tests) and dist/ (built) alike.
const PAGES_DIR = fileURLToPath(new URL("../pages/", import.meta.url));

const listMarkdownFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listMarkdownFiles(full);
    return entry.name.endsWith(".md") ? [full] : [];
  });

const toUrlPath = (file: string) => {
  const withoutExt = relative(PAGES_DIR, file)
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
        path: toUrlPath(file),
        title,
        markdown,
        contentHash: createHash("sha256").update(markdown).digest("hex"),
      };
    });
```

- `replace(/\r\n/g, "\n")`: a file saved on Windows would otherwise hash differently from the same
  text saved on Linux, and be re-embedded for nothing.
- `.sort()`: stable order, so ingestion logs and tests don't change between machines.
- A page without a title is a content bug; failing loudly beats storing a page called `undefined`.

### Step 5 — `src/splitSections.ts`

```ts
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
```

What each part does:

- The loop walks lines once. A heading at or above the split depth closes the current section
  (`flush`) and starts a new one; a deeper heading is kept as a line of text inside the section, so
  no words are lost at depth 2.
- `flush` drops empty sections: a `##` heading immediately followed by a `###` (at depth 3) has no
  text of its own and shouldn't become an empty chunk.
- The "overview" section catches an introduction under the `#` title. Its anchor `overview` doesn't
  exist on the website, so Phase 32 gives the page's intro an `id="overview"`.

`src/index.ts`:

```ts
export * from "./slug.js";
export * from "./loadPages.js";
export * from "./splitSections.js";
```

### Step 6 — Unit tests

`src/slug.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createSlugger, slugify } from "./slug.js";

describe("slugify", () => {
  it("lowercases and joins words with dashes", () => {
    expect(slugify("Fees for DUI cases")).toBe("fees-for-dui-cases");
  });

  it("drops punctuation and accents, spells out &", () => {
    expect(slugify("Wills, Trusts & Probate — Overview")).toBe(
      "wills-trusts-and-probate-overview",
    );
    expect(slugify("Mediación")).toBe("mediacion");
  });
});

describe("createSlugger", () => {
  it("numbers repeated headings within one page", () => {
    const slug = createSlugger();
    expect([slug("Hours"), slug("Hours"), slug("Hours")]).toEqual([
      "hours",
      "hours-2",
      "hours-3",
    ]);
  });

  it("starts fresh for each page", () => {
    expect(createSlugger()("Hours")).toBe("hours");
    expect(createSlugger()("Hours")).toBe("hours");
  });
});
```

`src/splitSections.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { splitSections } from "./splitSections.js";
import type { Page } from "./loadPages.js";

const page = (markdown: string): Page => ({
  path: "/t",
  title: "Fees",
  markdown,
  contentHash: "x",
});

const md = `# Fees

Intro text.

## How we charge

General.

### Flat fees

Flat text.

### Contingency fees

Contingency text.

## Payment plans

Monthly.
`;

describe("splitSections", () => {
  it("splits at ## and ### at depth 3", () => {
    const sections = splitSections(page(md), { depth: 3 });
    expect(sections.map((s) => s.anchor)).toEqual([
      "overview",
      "how-we-charge",
      "flat-fees",
      "contingency-fees",
      "payment-plans",
    ]);
  });

  it("keeps ### text inside its ## section at depth 2", () => {
    const sections = splitSections(page(md), { depth: 2 });
    expect(sections.map((s) => s.anchor)).toEqual([
      "overview",
      "how-we-charge",
      "payment-plans",
    ]);
    expect(sections[1]!.content).toContain("### Flat fees");
    expect(sections[1]!.content).toContain("Contingency text.");
  });

  it("gives a ### heading the same anchor at both depths", () => {
    // The ## that follows it is the 5th heading either way, so its anchor can't depend on depth.
    const d2 = splitSections(page(md), { depth: 2 }).map((s) => s.anchor);
    const d3 = splitSections(page(md), { depth: 3 }).map((s) => s.anchor);
    expect(d2.at(-1)).toBe(d3.at(-1));
  });

  it("loses no text", () => {
    const body = (depth: 2 | 3) =>
      splitSections(page(md), { depth })
        .map((s) => s.content)
        .join("\n");
    for (const word of [
      "Intro",
      "General",
      "Flat text",
      "Contingency text",
      "Monthly",
    ]) {
      expect(body(2)).toContain(word);
      expect(body(3)).toContain(word);
    }
  });

  it("prefixes searchText with page title and heading", () => {
    const [, second] = splitSections(page(md), { depth: 3 });
    expect(second!.searchText.startsWith("Fees > How we charge\n\n")).toBe(
      true,
    );
  });

  it("drops a heading with no text of its own", () => {
    const sections = splitSections(
      page("# T\n\n## Empty\n\n### Child\n\nText."),
      { depth: 3 },
    );
    expect(sections.map((s) => s.anchor)).toEqual(["child"]);
  });
});
```

And a test that checks the **real pages** obey the content rules, so a bad edit fails CI:

`src/pages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadPages } from "./loadPages.js";
import { splitSections } from "./splitSections.js";

const pages = loadPages();

describe("firm pages", () => {
  it("has 15–30 pages with unique paths", () => {
    expect(pages.length).toBeGreaterThanOrEqual(15);
    expect(pages.length).toBeLessThanOrEqual(30);
    expect(new Set(pages.map((p) => p.path)).size).toBe(pages.length);
  });

  it("keeps every section within 40–200 words at depth 3", () => {
    for (const p of pages) {
      for (const s of splitSections(p, { depth: 3 })) {
        const words = s.content.split(/\s+/).filter(Boolean).length;
        expect(words, `${p.path}#${s.anchor}`).toBeLessThanOrEqual(200);
      }
    }
  });

  it("states the fee facts the evals depend on", () => {
    const fees = pages.find((p) => p.path === "/fees")!.markdown;
    expect(fees).toContain("$2,500");
    expect(fees).toContain("33%");
    expect(fees).toContain("40%");
  });
});
```

(The lower 40-word bound is a writing guideline, not tested: an "Hours" section can legitimately be
short.)

## 7. Commit points

1. `feat(content): add content package with slugger, loader and heading splitter`
2. `test(content): unit-test slugs and section splitting`
3. `feat(content): write the harbor & vale demo firm pages`
4. `test(content): check page count, section size and key facts`

## 8. Verify

```bash
pnpm --filter @repo/content test
# ✓ src/slug.test.ts (4 tests)
# ✓ src/splitSections.test.ts (6 tests)
# ✓ src/pages.test.ts (3 tests)

pnpm --filter @repo/content build

# Look at the real split once
pnpm --filter @repo/content exec node --input-type=module -e '
import { loadPages, splitSections } from "./dist/index.js";
const pages = loadPages();
for (const d of [2, 3]) {
  const all = pages.flatMap((p) => splitSections(p, { depth: d }));
  const words = all.map((s) => s.content.split(/\s+/).length);
  console.log(`depth ${d}: ${all.length} sections, avg ${Math.round(words.reduce((a, b) => a + b, 0) / words.length)} words`);
}'
# depth 2: roughly 60–90 sections; depth 3: more, and smaller (write your real numbers down — Phase 23 uses them)

pnpm test       # from the root: turbo runs every package's test task
```

## 9. Common mistakes

- **A slug function in the website that "looks the same".** Use `@repo/content`'s, always.
- **Slugging only the headings that start sections.** Then `###` anchors change between depth 2 and
  3, and links break when you run the section-size experiment.
- **Putting the same fact on two pages with different wording** ("from $2,500" vs "around $2,000").
  The model will pick one, and the eval will be flaky.
- **Legal-advice tone in the pages.** The assistant echoes its sources.
- **Testing implementation details** (internal variable names) instead of inputs and outputs. Every
  test above is "given this markdown, these anchors/text come out".

## 10. Interview prep

**Q: How did you chunk the documents?**
A: By heading, because website pages are already organised into single-topic sections, and every
chunk then has a real anchor to cite. A depth setting (split at H2 only, or H2 and H3) is my chunk-size
variable, and each chunk is indexed with its page title and heading prepended for context.

**Q: How do you make sure citation links land on the right heading?**
A: The anchor is computed by one shared slug function used by both ingestion and the website, with
per-page numbering for repeated headings. There's a test that the anchor of a heading doesn't depend
on the split depth.

**Q: What did you unit test?**
A: The pure parts: slugging (punctuation, accents, duplicates) and splitting (boundaries at each depth,
no text lost, context prefix, empty sections dropped), plus content checks on the real pages so a bad
edit fails CI.

## 11. Resume-safe claim

"Built a heading-aware markdown chunker with configurable granularity and shared anchor generation
across ingestion and site rendering, covered by unit tests."

## 12. Definition of done

- [ ] 20 pages exist and every fact-sheet fact appears exactly once
- [ ] `pnpm --filter @repo/content test` passes
- [ ] I recorded section counts and average words at depth 2 and 3
- [ ] `pnpm build`, `pnpm typecheck`, `pnpm lint` pass from the root
