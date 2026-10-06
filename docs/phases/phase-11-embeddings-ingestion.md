# Phase 11 — Embeddings and idempotent ingestion

## 1. Goal

Fill the database: read the 20 pages, split them, turn every section into a 768-number embedding
with Gemini, and store pages and sections. Re-running it when nothing changed makes **zero** API
calls; a failure halfway through can be fixed by simply running it again.

Every embedding call is also recorded in `llmCall`, so ingestion's cost and latency show up in the
same reports as chat (Phase 20).

## 2. What I will understand after this phase

1. How the embedding API is called, and two traps in the current Gemini model that would silently
   ruin search.
2. Why documents and queries are embedded differently ("asymmetric retrieval").
3. What "idempotent" and "resumable" mean for a data pipeline, and how a hash gives both.
4. Why network calls happen **outside** the database transaction.
5. Why embeddings have no fallback provider, unlike chat.

## 3. Prerequisites

- Phase 10 done: `@repo/content` builds and its tests pass.
- A Gemini API key from Google AI Studio in `apps/api/.env` (`GEMINI_API_KEY`).
- `GEMINI_EMBEDDING_MODEL` set (see Step 2).

## 4. Files

```
apps/api/
├── package.json                         (@google/genai, @repo/content; ingest script)
└── src/
    ├── constants/env.ts                 (GEMINI_API_KEY, GEMINI_EMBEDDING_MODEL)
    ├── constants/embedding.ts           (prefixes, batch size)
    ├── ai/gemini.ts                     NEW  one client for the process
    ├── ai/embeddings.ts                 NEW  embedDocuments / embedQuery
    ├── services/llmCall.service.ts      NEW  recordLlmCall
    └── scripts/ingest.ts                NEW
```

## 5. Concepts

**The model, checked against current docs (October 2026).** Google's embeddings guide documents
`gemini-embedding-2`: default 3072 dimensions, recommended 768/1536/3072, and truncated outputs are
normalised automatically (the older `gemini-embedding-001` needed manual normalisation). Set
`GEMINI_EMBEDDING_MODEL=gemini-embedding-2`. If the guide has moved on by the time you build this,
read its "Migration" section before switching: embedding spaces of different models are
incompatible, and switching means re-embedding everything (ingestion does this automatically; see
the hash below).

**Trap 1 — task type.** `gemini-embedding-001` took a `taskType` parameter (`RETRIEVAL_DOCUMENT`,
`RETRIEVAL_QUERY`). The docs state that `gemini-embedding-2` does **not** support it; the task goes
into the text itself:

- document: `title: <title> | text: <content>`
- query: `task: question answering | query: <question>`

This is _asymmetric retrieval_: a short question and a long passage that answers it are different
kinds of text, and telling the model which is which puts them closer together.

**Trap 2 — batching.** The docs state that `gemini-embedding-2` returns **one aggregated embedding**
when several inputs are passed directly in one request. Passing `contents: ["a", "b", "c"]` would give
you one vector for all three — and storing it on three sections would make every search result a
coin toss, with no error anywhere. Each text must be wrapped in its own `Content` object
(`{ parts: [{ text }] }`) to get one vector per text. The code asserts that the number of vectors
returned equals the number of texts sent.

**Idempotent and resumable.** Each page stores a hash of everything that determines its stored
sections: the markdown, the split depth and the embedding model. On each run, a page whose hash
matches is skipped. So:

- run twice → the second run does nothing (idempotent);
- crash on page 12 → pages 1–11 are stored, rerun does 12–20 (resumable);
- change the depth or the model → every hash changes and everything is redone, which is exactly
  right because old vectors or old boundaries must not mix with new ones.

**Network outside the transaction.** For each changed page: embed first (network, slow, can fail),
**then** open a transaction that replaces the page's sections. A transaction held open during a
network call holds its locks and a pool connection for the whole call; if the call hangs, so does
everything waiting on those rows.

**No fallback for embeddings.** Chat can fall back to Groq (Phase 14) because any capable model can
write an answer. Embeddings can't fall back: a vector from a different model lives in a different
space, and comparing it with stored vectors gives nonsense distances without any error. If the
embedding API is down at query time, Phase 13 searches by keywords alone instead.

**Token counts for embeddings.** The SDK's `ContentEmbedding.statistics` (with token counts) is
documented as available on Vertex AI only, not the Gemini Developer API. So the `llmCall` row for an
embedding records latency and success, with `inputTokens` estimated as characters ÷ 4 — and the
estimate is labelled as one in Phase 20's report.

## 6. Steps

### Step 1 — Install

```bash
pnpm --filter api add @google/genai@^2.27.0 @repo/content@workspace:*
```

### Step 2 — Env and constants

`env.ts`:

```ts
export const GEMINI_API_KEY = getEnv("GEMINI_API_KEY");
export const GEMINI_EMBEDDING_MODEL = getEnv("GEMINI_EMBEDDING_MODEL");
```

`.env`: `GEMINI_EMBEDDING_MODEL=gemini-embedding-2`.

Append to `src/constants/embedding.ts`:

```ts
// gemini-embedding-2 takes the task as text, not as a parameter (see Phase 11 concepts).
export const documentInput = (title: string, text: string) =>
  `title: ${title} | text: ${text}`;
export const queryInput = (question: string) =>
  `task: question answering | query: ${question}`;

// Texts per embedContent request. Small enough to stay under per-request input limits and to keep a
// failed request cheap to retry; ~100 sections need ~5 requests.
export const EMBED_BATCH_SIZE = 20;
```

### Step 3 — `src/ai/gemini.ts`

```ts
import { GoogleGenAI } from "@google/genai";
import { GEMINI_API_KEY } from "../constants/env.js";

// One client per process, like the database pool.
export const gemini = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
```

### Step 4 — `src/services/llmCall.service.ts`

```ts
import { orm } from "../prisma/db.js";
import { getRequestId } from "../utils/requestContext.js";
import { logger } from "../utils/logger.js";

type LlmCallRecord = {
  purpose: "route" | "answer" | "lead" | "embed_query" | "embed_document";
  provider: string;
  model: string;
  latencyMs: number;
  ok: boolean;
  conversationId?: string;
  promptVersion?: string;
  inputTokens?: number;
  outputTokens?: number;
  firstTokenMs?: number;
  costMicros?: number;
  fellBack?: boolean;
  errorCode?: string;
};

// Telemetry must never break the thing it measures: a failed insert is logged and swallowed.
export const recordLlmCall = async (call: LlmCallRecord) => {
  try {
    await orm.LlmCall.create({ ...call, requestId: getRequestId() });
  } catch (error) {
    logger.error("failed to record llm call", { error, purpose: call.purpose });
  }
};
```

`requestId` comes from the request context (Phase 02); for scripts it's undefined, stored as null.

### Step 5 — `src/ai/embeddings.ts`

```ts
import { gemini } from "./gemini.js";
import { GEMINI_EMBEDDING_MODEL } from "../constants/env.js";
import {
  EMBED_BATCH_SIZE,
  EMBEDDING_DIMENSIONS,
  queryInput,
} from "../constants/embedding.js";
import { recordLlmCall } from "../services/llmCall.service.js";

const estimateTokens = (texts: string[]) =>
  Math.ceil(texts.join("").length / 4);

const embedBatch = async (
  texts: string[],
  purpose: "embed_query" | "embed_document",
) => {
  const startedAt = performance.now();
  try {
    const response = await gemini.models.embedContent({
      model: GEMINI_EMBEDDING_MODEL,
      // One Content per text. Passing bare strings would return ONE aggregated vector for all of them.
      contents: texts.map((text) => ({ parts: [{ text }] })),
      config: { outputDimensionality: EMBEDDING_DIMENSIONS },
    });

    const vectors = (response.embeddings ?? []).map(
      (embedding) => embedding.values ?? [],
    );
    if (
      vectors.length !== texts.length ||
      vectors.some((v) => v.length !== EMBEDDING_DIMENSIONS)
    ) {
      throw new Error(
        `Embedding shape mismatch: sent ${texts.length} texts, got ${vectors.length} vectors of length ${vectors[0]?.length}`,
      );
    }

    await recordLlmCall({
      purpose,
      provider: "gemini",
      model: GEMINI_EMBEDDING_MODEL,
      latencyMs: Math.round(performance.now() - startedAt),
      inputTokens: estimateTokens(texts),
      ok: true,
    });
    return vectors;
  } catch (error) {
    await recordLlmCall({
      purpose,
      provider: "gemini",
      model: GEMINI_EMBEDDING_MODEL,
      latencyMs: Math.round(performance.now() - startedAt),
      ok: false,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    throw error;
  }
};

// Texts must already be in document form (documentInput). Returns one vector per text, in order.
export const embedDocuments = async (texts: string[]) => {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    vectors.push(
      ...(await embedBatch(
        texts.slice(i, i + EMBED_BATCH_SIZE),
        "embed_document",
      )),
    );
  }
  return vectors;
};

export const embedQuery = async (question: string) => {
  const [vector] = await embedBatch([queryInput(question)], "embed_query");
  return vector!;
};
```

- The shape check is the guard for Trap 2. If Google changes the batching behaviour, ingestion fails
  loudly instead of storing wrong vectors.
- Batches run one after another, not in parallel: the free tier limits requests per minute, and five
  sequential requests take a few seconds.
- `performance.now()` is a monotonic clock, like `hrtime` in Phase 02.

### Step 6 — `src/scripts/ingest.ts`

```ts
import "dotenv/config";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { loadPages, splitSections } from "@repo/content";
import { db, orm } from "../prisma/db.js";
import { closeDB } from "../config/db.js";
import { embedDocuments } from "../ai/embeddings.js";
import { documentInput } from "../constants/embedding.js";
import { GEMINI_EMBEDDING_MODEL } from "../constants/env.js";

// Usage: pnpm --filter api ingest [--depth 2|3] [--force]
const { values } = parseArgs({
  options: {
    depth: { type: "string", default: "3" },
    force: { type: "boolean", default: false },
  },
});
const depth = values.depth === "2" ? 2 : 3;

const pages = loadPages();
const stored = await orm.Page.select("id", "path", "contentHash").all();
const storedByPath = new Map(stored.map((p) => [p.path, p]));

let skipped = 0;
let ingested = 0;

for (const page of pages) {
  // Everything that decides the stored sections. Change any of it and the page is redone.
  const ingestHash = createHash("sha256")
    .update(
      `${page.contentHash}|depth=${depth}|model=${GEMINI_EMBEDDING_MODEL}`,
    )
    .digest("hex");

  const existing = storedByPath.get(page.path);
  if (existing?.contentHash === ingestHash && !values.force) {
    skipped++;
    continue;
  }

  const drafts = splitSections(page, { depth });
  // Network first, outside any transaction.
  const vectors = await embedDocuments(
    drafts.map((d) => documentInput(`${page.title} > ${d.heading}`, d.content)),
  );

  await db.transaction(async (tx) => {
    const pageRow = existing
      ? await tx.orm.public.Page.where({ id: existing.id }).update({
          title: page.title,
          contentHash: ingestHash,
          updatedAt: new Date().toISOString(),
        })
      : await tx.orm.public.Page.create({
          path: page.path,
          title: page.title,
          contentHash: ingestHash,
        });

    // Replace, not merge: simpler than diffing, and the whole page is one atomic swap.
    await tx.orm.public.Section.where({ pageId: pageRow!.id }).deleteAll();
    for (const [i, draft] of drafts.entries()) {
      await tx.orm.public.Section.create({
        pageId: pageRow!.id,
        anchor: draft.anchor,
        heading: draft.heading,
        content: draft.content,
        searchText: draft.searchText,
        position: draft.position,
        contentHash: draft.contentHash,
        embedding: vectors[i]!,
        embeddingModel: GEMINI_EMBEDDING_MODEL,
      });
    }
  });

  ingested++;
  console.log(`ingested ${page.path} (${drafts.length} sections)`);
}

// Pages whose markdown file was deleted. Their sections go with them (cascade).
const livePaths = new Set(pages.map((p) => p.path));
const removedIds = stored
  .filter((p) => !livePaths.has(p.path))
  .map((p) => p.id);
if (removedIds.length) {
  await orm.Page.where((p) => p.id.in(removedIds)).deleteAll();
}

console.log(
  `done: ${ingested} ingested, ${skipped} unchanged, ${removedIds.length} removed (depth ${depth})`,
);
await closeDB();
```

Decisions worth being able to explain:

- **Replace the page's sections inside a transaction.** A reader never sees a half-updated page: the
  old sections are visible until the commit, the new ones after. Section ids change, so citations
  in old answers to _changed_ pages lose their `sectionId` (SetNull from Phase 05) but keep their
  URL and heading snapshot. Unchanged pages keep their ids.
- **The embedding input** uses the `title | text` document form, with `Page title > Heading` as the
  title. The `searchText` column (keyword search) holds the same information in plain form.
- **`pageRow!`**: `update` returns the updated row or null; it can't be null here because we just read
  the id. The `!` documents that assumption.

`package.json`:

```json
"ingest": "tsx src/scripts/ingest.ts"
```

`@repo/content` is consumed from its `dist/`, so `pnpm build` (or `pnpm --filter @repo/content build`)
must have run. From a fresh clone, `pnpm turbo run build --filter api` builds it first.

## 7. Commit points

1. `feat(api): add gemini client and llm call recording`
2. `feat(api): add document and query embeddings with shape check`
3. `feat(api): add idempotent, resumable ingestion script`

## 8. Verify

```bash
pnpm --filter @repo/content build
pnpm --filter api ingest
# ingested / (3 sections) … done: 20 ingested, 0 unchanged, 0 removed (depth 3)

pnpm --filter api ingest
# done: 0 ingested, 20 unchanged, 0 removed (depth 3)        ← zero API calls

docker exec counseldesk-postgres psql -U counseldesk -d counseldesk -c \
  "SELECT count(*), count(DISTINCT \"embeddingModel\"), min(vector_dims(embedding)), max(vector_dims(embedding)) FROM section;"
# N | 1 | 768 | 768

# Vectors are distinct (Trap 2 would make them identical within a batch)
docker exec counseldesk-postgres psql -U counseldesk -d counseldesk -c \
  "SELECT count(DISTINCT embedding::text) = count(*) AS all_distinct FROM section;"
# t

# Normalised (length ≈ 1)
docker exec counseldesk-postgres psql -U counseldesk -d counseldesk -c \
  "SELECT round(sqrt((SELECT sum(x*x) FROM unnest(embedding::real[]) x))::numeric, 3) FROM section LIMIT 3;"
# 1.000

# Calls were recorded
docker exec counseldesk-postgres psql -U counseldesk -d counseldesk -c \
  "SELECT purpose, count(*), round(avg(\"latencyMs\")) FROM \"llmCall\" GROUP BY purpose;"

# Change one page, rerun: only that page is re-embedded
echo "" >> packages/content/pages/contact.md && pnpm --filter @repo/content build && pnpm --filter api ingest
# done: 1 ingested, 19 unchanged

# Depth change redoes everything
pnpm --filter api ingest --depth 2     # 20 ingested
pnpm --filter api ingest --depth 3     # 20 ingested (back to the default)

# Quick sanity search by meaning: the DUI page should be near a drunk-driving question.
# (Phase 12 does this properly; this one-off is just reassurance.)
```

## 9. Common mistakes

- **`contents: texts`** (bare strings) with `gemini-embedding-2`: one aggregated vector, silently.
  The length check catches it — don't remove it.
- **Passing `taskType`** with `gemini-embedding-2`: unsupported per the docs; use the text prefixes.
- **Embedding the query without the query prefix** (or documents without theirs): retrieval gets
  measurably worse and nothing errors. Always go through `embedQuery` / `documentInput`.
- **Calling the API inside `db.transaction`.** Works on your laptop; holds locks and a connection for
  seconds in production.
- **Forgetting to rebuild `@repo/content`** after editing a page: ingestion reads the built `dist`
  loader, but the markdown itself is read from `pages/` at run time — the loader code is what needs
  building, the pages don't. (If you only edit markdown, no rebuild is needed; the `echo` above
  rebuilds out of habit.)
- **Mixing depths in one database.** Hashes prevent it, as long as you don't edit `contentHash` by hand.

## 10. Interview prep

**Q: Walk me through your ingestion pipeline.**
A: Load markdown pages, split by heading, embed each section in batches (one content object per text,
with the shape asserted), then per page replace its sections in one transaction. Each page stores a
hash of its markdown, split depth and embedding model, so unchanged pages are skipped: reruns are free
and a crash is fixed by rerunning.

**Q: What's asymmetric retrieval?**
A: Queries and documents are different kinds of text, so they're embedded with different task
instructions — here, "question answering | query" versus "title | text". It moves questions closer
to the passages that answer them.

**Q: Why no fallback provider for embeddings?**
A: Vectors from different models aren't comparable, so a fallback would corrupt search silently. If
embedding fails at query time, the system degrades to keyword search instead.

**Q: What would you do with 100,000 documents?**
A: Use the provider's batch API instead of synchronous calls, parallelise within rate limits, upsert
by section hash instead of replacing pages, and add an HNSW index with measured recall.

## 11. Resume-safe claim

"Built an idempotent, resumable embedding ingestion pipeline (content-hash skipping, per-page atomic
replacement) for [N] sections, with every model call recorded for cost and latency."

## 12. Definition of done

- [ ] All pages and sections stored; every vector has 768 dimensions and all are distinct
- [ ] A second run reports 0 ingested and makes no embedding calls
- [ ] Editing one page re-ingests only that page
- [ ] Changing `--depth` re-ingests everything
- [ ] `llmCall` has `embed_document` rows with latency
- [ ] I can explain both `gemini-embedding-2` traps
