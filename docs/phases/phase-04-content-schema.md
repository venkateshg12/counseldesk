# Phase 04 — Sections: the vector column and the full-text index

## 1. Goal

Add the `section` table: the unit the assistant searches and cites. Each row is one heading-sized
piece of a page, with its text, a 768-number embedding in a pgvector column, and a full-text index
over its words. Then prove both searches work in plain SQL before any TypeScript touches them.

Retrieval quality is decided here more than anywhere else: what a "section" is, what text gets
indexed, and how vectors are stored. Later phases only query what this table makes possible.

## 2. What I will understand after this phase

1. What an embedding is, what cosine distance measures, and what pgvector's `<=>` operator does.
2. How Postgres full-text search works: `to_tsvector`, `tsquery`, stemming, stop words, and the GIN
   index that makes it fast.
3. Why the full-text index must be over exactly the same expression the query uses.
4. Why there is **no** approximate vector index (HNSW) yet, and when there should be.
5. Why the embedding model's name is stored next to every vector.

## 3. Prerequisites

- Phase 03 done: the `page` table exists and `pnpm db:verify` is clean.

## 4. Files

```
apps/api/
├── src/prisma/contract.prisma        (Section model; relation on Page)
├── src/prisma/contract.json|d.ts     (re-emitted)
├── src/constants/embedding.ts        NEW
└── migrations/app/*_add_section/     generated
```

## 5. Concepts

**Embedding.** A model turns a piece of text into a fixed-length list of numbers (here 768) such that
texts with similar meaning point in similar directions. "Do you handle drunk driving?" and a section
titled "DUI defense" end up close even though they share no words. That's what keyword search
can't do.

**Cosine distance.** Measures the angle between two vectors, ignoring their length: 0 = same
direction, 1 = unrelated (orthogonal), 2 = opposite. pgvector's `<=>` operator computes it, so
`ORDER BY embedding <=> $query LIMIT 5` returns the five closest sections. The Gemini embedding
model normalises its vectors, so cosine is the right measure.

**Full-text search.** `to_tsvector('english', text)` turns text into normalised word stems with stop
words removed: "Defending clients charged with DUIs" → `'charg' 'client' 'defend' 'dui'`. A query
is turned into a `tsquery` the same way, so "defend" matches "defending". `websearch_to_tsquery`
accepts what people type into search boxes (`"exact phrase"`, `-exclude`, `or`) and never errors on
odd input. `ts_rank_cd` scores how well a row matches. This catches what embeddings are weak at:
exact names and codes ("DUI", "Phoenix", "A.R.S. 28-1381").

**GIN index, and why the expression must match.** A GIN (generalised inverted) index maps each
word stem to the rows containing it — like the index at the back of a book. Postgres only uses an
expression index when the query contains the identical expression: same function, same
configuration (`'english'`), same column. Prisma's `@@fullTextIndex([searchText])` renders
`to_tsvector('english', "searchText")`, so every query in Phase 12 must use exactly that.

**`searchText`.** The heading carries strong signal ("Fees and payment plans") but lives in a
different field from the body. Indexing one column that holds `heading + content` gives keyword
search both, with one index and one expression to match.

**No HNSW index — on purpose.** pgvector without an index compares the query with every row: an
exact nearest-neighbour search. With 15–30 pages (a few hundred sections) that's well under a
millisecond of work. An HNSW index makes search approximate (it can miss a true neighbour) in
exchange for speed at tens of thousands of rows and up. Adding it now would trade accuracy for
speed you don't need — and would make your eval numbers depend on an index setting. Phase 23 can
measure it as an experiment if you want the comparison.

**Storing the model name.** Vectors from different embedding models (or different dimension
settings) live in unrelated spaces; comparing them gives meaningless distances with no error. Each
row records the model that produced its vector, so ingestion can tell when everything must be
re-embedded, and a query embedding is always produced by the same model.

**Why 768 dimensions.** Google's current embedding docs recommend 768, 1536 or 3072 output
dimensions, default 3072, and state that `gemini-embedding-2` re-normalises truncated vectors
automatically. 768 is a quarter of the storage per row with little quality loss at this size of
corpus. The number is fixed by the column type, so changing it later means a migration plus a full
re-embed — decide it now, and confirm the model in Phase 11 before any data exists.

## 6. Steps

### Step 1 — `src/constants/embedding.ts`

```ts
// Fixed by the `vector(768)` column in contract.prisma. Changing it needs a migration and a full
// re-embed; it is not configuration.
export const EMBEDDING_DIMENSIONS = 768;
```

### Step 2 — The `Section` model

Add to `contract.prisma`, and add the back-relation to `Page`:

```prisma
model Page {
    id          Uuid              @id @default(uuid())
    path        String            @unique
    title       String
    contentHash String
    createdAt   TimestamptzString @default(now())
    updatedAt   TimestamptzString @default(now())
    sections    Section[]
}

// One heading-sized part of a page: what search returns and what an answer cites.
model Section {
    id             Uuid                          @id @default(uuid())
    pageId         Uuid
    // URL fragment for this heading ("fees-and-payment-plans"); citation = page path + "#" + anchor.
    anchor         String
    heading        String
    content        String
    // heading + "\n" + content: the one column keyword search indexes.
    searchText     String
    // Order of the section within its page, for rebuilding the page and for stable test output.
    position       Int
    contentHash    String
    embedding      pgvector.Vector(length: 768)
    // Which model produced `embedding`. Vectors from different models must never be compared.
    embeddingModel String
    createdAt      TimestamptzString             @default(now())
    page           Page                          @relation(fields: [pageId], references: [id], onDelete: Cascade)

    @@unique([pageId, anchor])
    @@index([pageId])
    @@fullTextIndex([searchText], name: "section_search_text")
}
```

Design decisions, one line each:

- `embedding` is **not** nullable. A section without a vector can't be retrieved by meaning, so
  ingestion (Phase 11) embeds first and inserts after: there is never a half-ready row.
- `onDelete: Cascade`: deleting a page deletes its sections. Pages are only deleted by ingestion
  when the markdown file disappears.
- `@@unique([pageId, anchor])`: two headings with the same text on one page get different anchors
  (`fees`, `fees-2`); the splitter in Phase 10 guarantees this, and the constraint makes the
  database refuse a bug in it.
- `@@index([pageId])`: "all sections of this page" is what ingestion and the website ask for.

### Step 3 — Plan, read, apply

```bash
cd apps/api
pnpm db:plan add_section
pnpm db:sql
```

Read `migrations/app/*_add_section/migration.sql` before applying. You should find:

- `"embedding" vector(768) NOT NULL`
- a foreign key to `"page"` with `ON DELETE CASCADE`
- a unique index on `("pageId", "anchor")`
- a GIN index whose expression is `to_tsvector('english', "searchText")`

If the index expression is different from that, stop: Phase 12's queries depend on it.

```bash
pnpm db:migrate
pnpm db:verify
```

### Step 4 — Prove both searches in SQL

Do this by hand in `psql`. It is the fastest way to understand what Phase 12 will automate.

```bash
docker exec -it counseldesk-postgres psql -U counseldesk -d counseldesk
```

```sql
-- A test page and three sections with fake 768-number vectors.
INSERT INTO page (id, path, title, "contentHash")
VALUES ('00000000-0000-0000-0000-000000000001', '/test', 'Test', 'x');

INSERT INTO section (id, "pageId", anchor, heading, content, "searchText", position, "contentHash", embedding, "embeddingModel")
VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'dui', 'DUI defense',
   'We defend clients charged with DUI in Phoenix.', 'DUI defense' || E'\n' || 'We defend clients charged with DUI in Phoenix.',
   0, 'a', array_fill(0.1::real, ARRAY[768])::vector, 'test'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'fees', 'Fees',
   'Our consultation is free.', 'Fees' || E'\n' || 'Our consultation is free.',
   1, 'b', array_fill(-0.1::real, ARRAY[768])::vector, 'test'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'about', 'About us',
   'Founded in 2001.', 'About us' || E'\n' || 'Founded in 2001.',
   2, 'c', (array_fill(0.1::real, ARRAY[767]) || ARRAY[0.9::real])::vector, 'test');

-- Keyword search. Note "defending" matches "defend" (stemming), and the words don't need to be adjacent.
SELECT anchor, ts_rank_cd(to_tsvector('english', "searchText"), q) AS rank
FROM section, websearch_to_tsquery('english', 'defending dui') AS q
WHERE to_tsvector('english', "searchText") @@ q
ORDER BY rank DESC;
-- dui | 0.1…

-- Prove the index CAN be used (with three rows the planner prefers a scan, which is correct).
SET enable_seqscan = off;
EXPLAIN SELECT anchor FROM section
WHERE to_tsvector('english', "searchText") @@ websearch_to_tsquery('english', 'dui');
-- … Bitmap Index Scan on section_search_text_…
RESET enable_seqscan;

-- Vector search: nearest to an all-0.1 query vector.
SELECT anchor, embedding <=> array_fill(0.1::real, ARRAY[768])::vector AS distance
FROM section
ORDER BY distance
LIMIT 3;
-- dui   | 0          (identical direction)
-- about | small      (almost the same direction)
-- fees  | 2          (opposite direction)

-- What a mismatched expression does: the index is NOT used for 'simple' config.
SET enable_seqscan = off;
EXPLAIN SELECT anchor FROM section
WHERE to_tsvector('simple', "searchText") @@ websearch_to_tsquery('simple', 'dui');
-- Seq Scan (the planner had no choice: no index on that expression)
RESET enable_seqscan;

-- Clean up.
DELETE FROM page WHERE id = '00000000-0000-0000-0000-000000000001';
SELECT count(*) FROM section;   -- 0: the cascade removed the sections
```

## 7. Commit points

1. `feat(db): add section table with vector embedding and full-text index`

## 8. Verify

- `\d section` shows `embedding vector(768) not null` and the GIN index.
- The three SQL experiments above behave as commented.
- `pnpm db:verify` is clean.
- `pnpm typecheck` passes (the re-emitted `contract.d.ts` now types `embedding` as a 768-length
  vector).

## 9. Common mistakes

- **Using `to_tsvector(searchText)` without `'english'` in a query.** That uses the server's default
  configuration; even if it happens to be English, the expression no longer matches the index.
  Always pass the configuration explicitly.
- **Indexing `content` only.** Headings then don't count in keyword search, and "fees" won't find
  the "Fees" section whose body never says the word.
- **Choosing the dimension after inserting data.** Every vector must be regenerated. Settle it here.
- **Comparing vectors from two models**, e.g. re-embedding the query with a newer model while
  sections still hold the old one. No error, just quietly bad results. `embeddingModel` exists to
  catch exactly this.
- **Adding HNSW "because production apps have it".** At this size it only makes results approximate.
  Know why you would add it (tens of thousands of rows, latency you measured) before you do.

## 10. Interview prep

**Q: Why hybrid search instead of only vector search?**
A: Embeddings capture meaning but are weak on exact tokens like names, codes and acronyms; full-text
search is the opposite. Running both and merging the rankings covers both failure modes. The eval
suite (Phase 23) measures each on its own and combined.

**Q: How does Postgres full-text search work?**
A: Text is normalised into a `tsvector` of stemmed words without stop words; the query becomes a
`tsquery` the same way; `@@` matches them and `ts_rank_cd` scores the match. A GIN index maps stems
to rows, and is only used when the query uses the same expression and text-search configuration as
the index.

**Q: Why no HNSW index?**
A: With a few hundred rows an exact scan is sub-millisecond and gives true nearest neighbours. HNSW
trades recall for speed at much larger scales. I'd add it when the corpus or latency numbers called
for it, and measure recall before and after.

**Q: What happens if you change embedding models?**
A: Every stored vector becomes incomparable with new query vectors. I store the model on each row,
and ingestion re-embeds everything when the configured model differs.

## 11. Resume-safe claim

"Designed a Postgres retrieval schema combining pgvector embeddings with a GIN-indexed full-text
search column, verified index usage with EXPLAIN."

## 12. Definition of done

- [ ] `section` exists with `vector(768) NOT NULL`, the unique `(pageId, anchor)` and the GIN index
- [ ] I read the generated SQL and the index expression is `to_tsvector('english', "searchText")`
- [ ] The keyword, vector and mismatched-expression experiments behave as described
- [ ] Deleting a page cascades to its sections
- [ ] `pnpm db:verify` clean, typecheck passes
