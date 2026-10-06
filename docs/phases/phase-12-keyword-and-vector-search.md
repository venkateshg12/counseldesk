# Phase 12 — Keyword search and vector search

## 1. Goal

Write the two searches as plain, parameterised SQL in one service, each returning a ranked list of
section ids:

- **keyword search**: Postgres full-text search over `searchText`, using the GIN index from Phase 04;
- **vector search**: pgvector cosine distance between the question's embedding and every section.

Plus a small command-line script that runs both for a question and prints the two rankings side by
side. Looking at where they disagree is the best way to understand why Phase 13 merges them.

## 2. What I will understand after this phase

1. Why a natural-language question needs an **OR** text query, not the AND that
   `websearch_to_tsquery` builds.
2. How to keep the query expression identical to the index expression, and confirm it with `EXPLAIN`.
3. How a vector is passed to SQL safely as a parameter.
4. Why raw SQL is used here instead of the ORM, and why it's still injection-safe.
5. How to read two rankings and predict where each search fails.

## 3. Prerequisites

- Phase 11 done: sections and embeddings are stored.

## 4. Files

```
apps/api/src/
├── constants/search.ts           NEW
├── services/search.service.ts    NEW  keywordSearch, vectorSearch, getSectionsByIds
└── scripts/search.ts             NEW  side-by-side comparison
```

## 5. Concepts

**AND vs OR for questions.** `websearch_to_tsquery('english', 'Do you handle DUI cases in Phoenix?')`
becomes `'handl' & 'dui' & 'case' & 'phoenix'`: a section must contain **all four** stems. The DUI
page talks about DUI cases but probably not "handle" _and_ "Phoenix" in the same section, so it isn't
returned at all. `websearch_to_tsquery` is designed for a search box where people type keywords.
For questions, this phase builds the query from the question's own stems joined by OR
(`'handl' | 'dui' | 'case' | 'phoenix'`) and lets the ranking function reward sections that match
more of them. Stop words ("do", "you", "in") are already removed by `to_tsvector`.

The SQL that does it:

```sql
to_tsquery('simple', string_agg(quote_literal(lexeme), ' | '))
FROM unnest(tsvector_to_array(to_tsvector('english', $1))) AS lexeme
```

- `to_tsvector('english', $1)` stems the question and drops stop words, exactly as the documents
  were processed.
- `tsvector_to_array` + `unnest` turn it into one row per stem.
- `quote_literal` wraps each stem in quotes so a token like `28-1381` can't be read as operators.
- `string_agg(…, ' | ')` joins them with OR.
- `to_tsquery('simple', …)`: the stems are already stemmed, so the query side uses the `simple`
  configuration, which doesn't stem again. (The index is on the _document_ expression, so the query
  side's configuration doesn't affect whether the index is used.)

Phase 23 can measure AND against OR on the golden set; that makes a good one-variable experiment.

**Ranking.** `ts_rank_cd` (cover density) scores higher when more query terms appear and when they
appear close together. Ties are broken by section id so results are deterministic — evals need the
same input to give the same order.

**Parameterised raw SQL.** The ORM can express both searches (Prisma 8 has `fullTextRank` and
`cosineDistance`), but the point of this phase is that you can read and `EXPLAIN` the exact SQL, and
the e-commerce port uses `pool.query` for the same reason (its facets and listing). Values are
passed as `$1`, `$2` parameters, never concatenated into the string: the database receives the SQL
and the values separately, so a question containing `'; DROP TABLE` is just text.

**Passing a vector.** pgvector's text format is `[0.1,0.2,…]`, which is exactly what
`JSON.stringify(numberArray)` produces. It's sent as a parameter and cast with `$1::vector`. No extra
library is needed.

**Filtering by model.** The vector query only compares against rows whose `embeddingModel` equals
the current model. After a model change and before re-ingestion finishes, that returns fewer rows
instead of meaningless distances.

## 6. Steps

### Step 1 — `src/constants/search.ts`

```ts
// How many candidates each search returns before merging (Phase 13).
export const SEARCH_CANDIDATES = 20;
```

### Step 2 — `src/services/search.service.ts`

```ts
import { pool } from "../prisma/db.js";
import { GEMINI_EMBEDDING_MODEL } from "../constants/env.js";
import { SEARCH_CANDIDATES } from "../constants/search.js";

export type RankedId = { id: string; score: number };

/*
  OR over the question's stems, ranked by ts_rank_cd. The WHERE and ORDER BY use
  to_tsvector('english', "searchText") — the exact expression of the GIN index from the contract's
  @@fullTextIndex — so the index can be used.
 */
const KEYWORD_SQL = `
  WITH q AS (
    SELECT to_tsquery('simple', string_agg(quote_literal(lexeme), ' | ')) AS query
    FROM unnest(tsvector_to_array(to_tsvector('english', $1))) AS lexeme
  )
  SELECT s.id, ts_rank_cd(to_tsvector('english', s."searchText"), q.query) AS score
  FROM section s, q
  WHERE q.query IS NOT NULL
    AND to_tsvector('english', s."searchText") @@ q.query
  ORDER BY score DESC, s.id
  LIMIT $2
`;

export const keywordSearch = async (
  question: string,
  limit = SEARCH_CANDIDATES,
): Promise<RankedId[]> => {
  const { rows } = await pool.query<{ id: string; score: number }>(
    KEYWORD_SQL,
    [question, limit],
  );
  return rows;
};

// Cosine distance: 0 = same direction. Score is reported as similarity (1 - distance) so higher is
// better in both searches.
const VECTOR_SQL = `
  SELECT id, 1 - (embedding <=> $1::vector) AS score
  FROM section
  WHERE "embeddingModel" = $2
  ORDER BY embedding <=> $1::vector, id
  LIMIT $3
`;

export const vectorSearch = async (
  queryVector: number[],
  limit = SEARCH_CANDIDATES,
): Promise<RankedId[]> => {
  const { rows } = await pool.query<{ id: string; score: number }>(VECTOR_SQL, [
    JSON.stringify(queryVector),
    GEMINI_EMBEDDING_MODEL,
    limit,
  ]);
  return rows;
};

export type SectionHit = {
  id: string;
  anchor: string;
  heading: string;
  content: string;
  pagePath: string;
  pageTitle: string;
};

// Full rows for a list of ids, returned in the same order as the ids (SQL IN doesn't keep order).
export const getSectionsByIds = async (
  ids: string[],
): Promise<SectionHit[]> => {
  if (ids.length === 0) return [];
  const { rows } = await pool.query<SectionHit>(
    `SELECT s.id, s.anchor, s.heading, s.content, p.path AS "pagePath", p.title AS "pageTitle"
     FROM section s JOIN page p ON p.id = s."pageId"
     WHERE s.id = ANY($1::uuid[])`,
    [ids],
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is SectionHit => row !== undefined);
};
```

- `pool.query<T>` types the rows; Postgres returns `real` scores, which `pg` gives you as numbers.
- `WHERE q.query IS NOT NULL`: a question made only of stop words ("is it?") produces no stems; the
  query is null and the search returns nothing instead of erroring.
- `= ANY($1::uuid[])` passes the whole id list as one array parameter (node-postgres converts a JS
  array to a Postgres array), instead of building `IN ($1, $2, …)` by hand.
- Table names are lowercase (`section`, `page`) and camelCase columns are quoted (`"searchText"`),
  as Prisma 8 created them (Phase 03).

### Step 3 — `src/scripts/search.ts`

```ts
import "dotenv/config";
import {
  keywordSearch,
  vectorSearch,
  getSectionsByIds,
} from "../services/search.service.js";
import { embedQuery } from "../ai/embeddings.js";
import { closeDB } from "../config/db.js";

// Usage: pnpm --filter api search "Do you handle DUI cases in Phoenix?"
const question = process.argv.slice(2).join(" ");
if (!question) {
  console.error('Usage: pnpm --filter api search "<question>"');
  process.exit(1);
}

const [keyword, vector] = await Promise.all([
  keywordSearch(question, 5),
  embedQuery(question).then((v) => vectorSearch(v, 5)),
]);

const label = async (list: { id: string; score: number }[]) => {
  const sections = await getSectionsByIds(list.map((r) => r.id));
  return sections.map(
    (s, i) => `${list[i]!.score.toFixed(3)}  ${s.pagePath}#${s.anchor}`,
  );
};

console.log("KEYWORD");
console.log((await label(keyword)).join("\n") || "  (no matches)");
console.log("\nVECTOR");
console.log((await label(vector)).join("\n"));

await closeDB();
```

`package.json`: `"search": "tsx src/scripts/search.ts"`.

## 7. Commit points

1. `feat(api): add keyword search with OR query over question stems`
2. `feat(api): add pgvector cosine search filtered by embedding model`
3. `feat(api): add side-by-side search comparison script`

## 8. Verify

Run these and **write down what you see** — Phase 13's merge and Phase 23's experiments start from it.

```bash
pnpm --filter api search "Do you handle DUI cases in Phoenix?"
# Both lists should have /practice-areas/dui sections near the top.

pnpm --filter api search "How much is a lawyer for a first drunk driving charge?"
# Vector finds /fees#dui-fees (meaning: "drunk driving" ≈ DUI, "how much" ≈ fees).
# Keyword may miss it: "drunk", "driving" and "lawyer" may not appear in that section.

pnpm --filter api search "ARS 28-1381"
# Keyword is good at exact tokens; vector may rank it poorly.

pnpm --filter api search "Is it?"
# KEYWORD (no matches) — only stop words; no error.

# AND vs OR, by hand in psql: the AND query returns fewer (often zero) rows
docker exec counseldesk-postgres psql -U counseldesk -d counseldesk -c "
SELECT count(*) FROM section
WHERE to_tsvector('english', \"searchText\") @@ websearch_to_tsquery('english', 'Do you handle DUI cases in Phoenix?');"

# The keyword query can use the GIN index (forced, since the table is small)
docker exec counseldesk-postgres psql -U counseldesk -d counseldesk -c "
SET enable_seqscan = off;
EXPLAIN SELECT id FROM section WHERE to_tsvector('english', \"searchText\") @@ to_tsquery('simple', '''dui'' | ''fee''');"
# … Bitmap Index Scan on section_search_text_…

# Injection is just text
pnpm --filter api search "'; DROP TABLE section; --"
# runs normally; the table is still there
```

## 9. Common mistakes

- **Using `websearch_to_tsquery` for questions.** Recall collapses; the tests in Phase 22 will show
  near-zero keyword hits on natural questions.
- **Building SQL with template strings around user input.** Always `$n` parameters.
- **`to_tsvector("searchText")` without `'english'`** in the query. The index stops being used.
- **Ordering vector results by `score DESC` (similarity) in SQL.** Fine logically, but
  `ORDER BY embedding <=> $1` is the form an HNSW index (if you ever add one) can use. Keep it.
- **Forgetting the id tie-breaker.** Equal scores come back in arbitrary order, and evals flicker.
- **`SELECT … WHERE id IN (…)` and assuming the order matches.** It doesn't; `getSectionsByIds`
  restores it.

## 10. Interview prep

**Q: How do you do keyword search for natural-language questions in Postgres?**
A: I turn the question into its stemmed lexemes with `to_tsvector`, join them with OR into a
`tsquery`, and rank matches with `ts_rank_cd`. The default web-search parser ANDs every word, which
kills recall for full questions.

**Q: How do you pass embeddings to Postgres?**
A: As a parameter in pgvector's text format — `JSON.stringify` of the number array — cast to `vector`
in SQL. Nothing is concatenated into the query string.

**Q: Why raw SQL instead of the ORM here?**
A: Search is the part I most need to read, `EXPLAIN` and tune. The ORM supports these operators, but
for this I want the exact SQL visible. It's still fully parameterised.

## 11. Resume-safe claim

"Implemented Postgres full-text (OR-of-stems with ts_rank_cd over a GIN index) and pgvector cosine
search as parameterised SQL, validating index use with EXPLAIN."

## 12. Definition of done

- [ ] `search` prints both rankings for any question; stop-word-only questions don't error
- [ ] The AND query returns fewer rows than the OR query for a natural question (recorded)
- [ ] `EXPLAIN` shows the GIN index can serve the keyword query
- [ ] I've noted two questions where keyword and vector disagree, and why
