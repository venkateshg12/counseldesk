# Phase 13 — Hybrid search with Reciprocal Rank Fusion

## 1. Goal

Merge the two rankings from Phase 12 into one with **Reciprocal Rank Fusion (RRF)**, written by hand
as the spec requires, unit-tested, and wrapped in one `retrieve()` function the chat will call. Add a
staff-only debug endpoint that shows the keyword list, the vector list and the merged list for any
question.

`retrieve()` also degrades gracefully: if the embedding API fails, it returns keyword results alone
and says so, instead of failing the chat.

## 2. What I will understand after this phase

1. Why the two searches' scores can't simply be added, and how RRF avoids comparing them at all.
2. What the constant `k = 60` does.
3. How to test a ranking function: properties, not snapshots.
4. Graceful degradation: which failures should stop a request and which should only weaken it.

## 3. Prerequisites

- Phase 12 done.

## 4. Files

```
apps/api/
├── package.json                       (vitest; test script)
├── vitest.config.ts                   NEW
└── src/
    ├── constants/search.ts            (RRF_K, CONTEXT_SECTIONS, SearchMode)
    ├── utils/rrf.ts                   NEW
    ├── utils/rrf.test.ts              NEW
    ├── services/search.service.ts     (retrieve)
    ├── controllers/debug.controller.ts NEW
    ├── routes/debug.route.ts          NEW
    └── app.ts                         (mount /debug)
```

## 5. Concepts

**Why not add the scores?** Keyword scores (`ts_rank_cd`) are small, unbounded numbers that depend on
document length and term counts; vector scores are similarities near 0.4–0.9. Adding or averaging
them lets whichever scale happens to be larger win. Normalising them (min-max) depends on what else
is in that result list, so the same section scores differently for every question.

**Reciprocal Rank Fusion.** Ignore the scores; use only positions. Each list gives an item
`1 / (k + rank)` points (rank 1, 2, 3, …), and an item's total is the sum over the lists it appears
in. An item ranked high in both lists beats one ranked first in only one. It needs no training and no
tuning beyond `k`, which is why it's the standard first choice for hybrid search.

**`k = 60`.** With `k = 0`, rank 1 gets 1.0 and rank 2 gets 0.5: the top of each list dominates. A
larger `k` flattens the curve (1/61 vs 1/62), so agreement between lists matters more than being
first in one. 60 is the value from the original RRF paper and the common default; Phase 23 can test
another.

**What goes to the model.** Each search returns 20 candidates; fusion ranks the union; the top 5
(`CONTEXT_SECTIONS`) are given to the model as sources. Five short sections fit easily in the prompt,
and fewer sources make citations easier to check.

**Degradation.** Keyword search needs only Postgres; vector search needs Postgres **and** the
embedding API. If Postgres is down, nothing works — let it fail. If only the embedding call fails
(rate limit, outage), keyword results are still useful: return them, mark the result
`degraded: true`, log a warning, and let the chat answer from what it has. A weaker answer beats an
error page.

**Testing a ranking.** Snapshot tests ("the output equals this array") break whenever you touch
anything and don't say _why_ the order is right. Test the properties RRF promises: an item found by
both lists outranks an item found by one at the same positions; a single list keeps its order; ties
are deterministic; empty input gives empty output.

## 6. Steps

### Step 1 — Vitest in the API

```bash
pnpm --filter api add -D vitest@^5.0.3
```

`apps/api/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
```

`package.json`: `"test": "vitest run"`. Add `"src/**/*.test.ts"` to `exclude` in `tsconfig.json` so
tests aren't compiled into `dist`.

### Step 2 — Constants

Append to `src/constants/search.ts`:

```ts
// Reciprocal Rank Fusion constant (original paper's value). Larger = agreement matters more than rank.
export const RRF_K = 60;

// Sections given to the model as sources.
export const CONTEXT_SECTIONS = 5;

export const SEARCH_MODES = ["hybrid", "keyword", "vector"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];
```

`SearchMode` exists so Phase 23 can run the eval suite with each mode alone and with both.

### Step 3 — `src/utils/rrf.ts`

```ts
export type Fused = { id: string; score: number };

/*
  Reciprocal Rank Fusion. Each list contributes 1 / (k + rank) for every id it contains (rank starts
  at 1); an id's score is the sum across lists. Only positions are used, never the original scores,
  so lists whose scores are on different scales can be merged.
 */
export const reciprocalRankFusion = (lists: string[][], k: number): Fused[] => {
  const scores = new Map<string, number>();

  for (const list of lists) {
    list.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
    });
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
};
```

If an id appears twice in one list (it shouldn't), it's counted twice. The searches can't return
duplicates — `id` is the primary key — so that case isn't handled.

### Step 4 — `src/utils/rrf.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "./rrf.js";

const ids = (fused: { id: string }[]) => fused.map((f) => f.id);

describe("reciprocalRankFusion", () => {
  it("keeps the order of a single list", () => {
    expect(ids(reciprocalRankFusion([["a", "b", "c"]], 60))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("ranks an item found by both lists above items found by one", () => {
    // "b" is second in both; "a" and "c" are each first in only one.
    const fused = reciprocalRankFusion(
      [
        ["a", "b"],
        ["c", "b"],
      ],
      60,
    );
    expect(fused[0]!.id).toBe("b");
  });

  it("computes 1/(k+rank) per list", () => {
    const [top] = reciprocalRankFusion([["a"], ["a"]], 60);
    expect(top!.score).toBeCloseTo(2 / 61);
  });

  it("includes items that appear in only one list", () => {
    expect(ids(reciprocalRankFusion([["a"], ["b"]], 60)).sort()).toEqual([
      "a",
      "b",
    ]);
  });

  it("breaks ties by id so results are deterministic", () => {
    expect(ids(reciprocalRankFusion([["b"], ["a"]], 60))).toEqual(["a", "b"]);
  });

  it("lets a small k favour the top of each list", () => {
    // x: 1st in list 1 only. y: 3rd in both lists.
    const lists = [
      ["x", "p", "y"],
      ["q", "r", "y"],
    ];
    const position = (k: number, id: string) =>
      ids(reciprocalRankFusion(lists, k)).indexOf(id);

    expect(position(0, "x")).toBeLessThan(position(0, "y")); // 1/1 beats 1/3 + 1/3
    expect(position(60, "y")).toBeLessThan(position(60, "x")); // 2/63 beats 1/61
  });

  it("handles empty input", () => {
    expect(reciprocalRankFusion([], 60)).toEqual([]);
    expect(reciprocalRankFusion([[], []], 60)).toEqual([]);
  });
});
```

Check the k test by hand once, because it's the one that shows the idea: with `k = 0`, x gets
1/1 = 1.0 and y gets 1/3 + 1/3 ≈ 0.67, so x wins. With `k = 60`, x gets 1/61 ≈ 0.0164 and y gets
2/63 ≈ 0.0317, so y wins.

### Step 5 — `retrieve()`

Append to `search.service.ts`:

```ts
import { embedQuery } from "../ai/embeddings.js";
import { reciprocalRankFusion } from "../utils/rrf.js";
import {
  CONTEXT_SECTIONS,
  RRF_K,
  type SearchMode,
} from "../constants/search.js";
import { logger } from "../utils/logger.js";

export type Retrieval = {
  sections: SectionHit[];
  keywordIds: string[];
  vectorIds: string[];
  // True when vector search was wanted but the embedding call failed.
  degraded: boolean;
};

export const retrieve = async (
  question: string,
  { mode = "hybrid" as SearchMode, limit = CONTEXT_SECTIONS } = {},
): Promise<Retrieval> => {
  const wantKeyword = mode !== "vector";
  const wantVector = mode !== "keyword";

  const keywordPromise = wantKeyword
    ? keywordSearch(question)
    : Promise.resolve([]);
  const vectorPromise = wantVector
    ? embedQuery(question)
        .then((vector) => vectorSearch(vector))
        .catch((error: unknown) => {
          logger.warn("vector search unavailable, using keyword results only", {
            error,
          });
          return null;
        })
    : Promise.resolve([]);

  const [keyword, vector] = await Promise.all([keywordPromise, vectorPromise]);

  const keywordIds = keyword.map((r) => r.id);
  const vectorIds = (vector ?? []).map((r) => r.id);
  const fusedIds = reciprocalRankFusion([keywordIds, vectorIds], RRF_K).map(
    (f) => f.id,
  );

  return {
    sections: await getSectionsByIds(fusedIds.slice(0, limit)),
    keywordIds,
    vectorIds,
    degraded: wantVector && vector === null,
  };
};
```

- The two searches run in parallel (`Promise.all`): total time is the slower one, not the sum.
- Only the embedding/vector path is caught. A keyword search failure (Postgres down) still rejects
  and fails the request, on purpose.
- With `mode: "keyword"` or `"vector"`, fusing a single non-empty list just returns that list's order
  (the first unit test), so one code path serves all three modes.
- `keywordIds` and `vectorIds` are returned for the debug endpoint and the eval runner (Phase 22
  scores each list separately).

### Step 6 — Debug endpoint (staff only)

`src/controllers/debug.controller.ts`:

```ts
import { z } from "zod";
import { catchError } from "../utils/errors/index.js";
import { ok } from "../utils/api/index.js";
import { OK } from "../constants/http.js";
import { SEARCH_MODES } from "../constants/search.js";
import { getSectionsByIds, retrieve } from "../services/search.service.js";

const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(500),
  mode: z.enum(SEARCH_MODES).default("hybrid"),
});

const label = async (ids: string[]) =>
  (await getSectionsByIds(ids.slice(0, 10))).map(
    (s) => `${s.pagePath}#${s.anchor}`,
  );

export const debugSearchHandler = catchError(async (req, res) => {
  const { q, mode } = searchQuerySchema.parse(req.query);
  const result = await retrieve(q, { mode });

  res.status(OK).json(
    ok({
      degraded: result.degraded,
      keyword: await label(result.keywordIds),
      vector: await label(result.vectorIds),
      merged: result.sections.map((s) => `${s.pagePath}#${s.anchor}`),
    }),
  );
});
```

`src/routes/debug.route.ts`:

```ts
import { Router } from "express";
import authenticate from "../middleware/authenticate.js";
import { debugSearchHandler } from "../controllers/debug.controller.js";

export const debugRoutes = Router();

// Staff only: it spends embedding quota and reveals how retrieval works.
debugRoutes.get("/search", authenticate, debugSearchHandler);
```

`app.ts`: `app.use("/debug", debugRoutes);` after `/auth`.

## 7. Commit points

1. `feat(api): add reciprocal rank fusion with unit tests`
2. `feat(api): add hybrid retrieve with keyword-only degradation`
3. `feat(api): add staff-only search debug endpoint`

## 8. Verify

```bash
pnpm --filter api test
# ✓ src/utils/rrf.test.ts (7 tests)

# Logged in as staff (cookie jar from Phase 07)
curl -s -b /tmp/cd-cookies "localhost:4000/debug/search?q=How%20much%20for%20a%20first%20drunk%20driving%20charge" | jq
# keyword: […], vector: […/fees#dui-fees …], merged: /fees#dui-fees near the top

curl -s -b /tmp/cd-cookies "localhost:4000/debug/search?q=dui&mode=keyword" | jq .data.vector   # []
curl -s "localhost:4000/debug/search?q=dui" | jq .errors           # 401 without staff login

# Degradation: put a wrong GEMINI_API_KEY in .env, restart, query again
# → "degraded": true, merged = keyword results, a WARN line in the log, and status 200
```

## 9. Common mistakes

- **Averaging normalised scores "because it's more precise".** It isn't comparable across questions;
  that's the problem RRF exists to avoid.
- **Ranks starting at 0.** Then rank 1 gets `1/k` and with `k = 0` divides by zero. `index + 1`.
- **Catching every error in `retrieve`.** A Postgres outage would turn into empty search results
  and confident "I couldn't find that" answers — worse than an error.
- **A public debug endpoint.** It burns quota for anyone who finds it.
- **Snapshot-testing the fused order** of real search results. Real results change whenever content
  changes; test RRF's properties on synthetic lists.

## 10. Interview prep

**Q: How do you merge keyword and vector results?**
A: Reciprocal Rank Fusion: each list contributes 1/(k + rank) per item and I sum across lists. It uses
only positions, so the two searches' incompatible score scales never meet. k = 60 makes agreement
between lists count more than a single first place.

**Q: What happens if the embedding provider is down?**
A: Retrieval falls back to keyword results only, flags the result as degraded, and logs it; the chat
still answers. Database failures, by contrast, fail the request, because empty results would produce
confidently wrong answers.

**Q: How did you test it?**
A: Property-style unit tests on synthetic lists: single-list order preserved, agreement beats a single
first place, the exact 1/(k+rank) value, deterministic ties, and how k changes the winner.

## 11. Resume-safe claim

"Implemented hybrid retrieval with hand-written Reciprocal Rank Fusion over Postgres full-text and
pgvector results, with graceful degradation to keyword search when embeddings are unavailable."

## 12. Definition of done

- [ ] RRF tests pass, including the k test I worked through by hand
- [ ] `/debug/search` shows three lists; `mode` works; 401 without login
- [ ] A broken embedding key gives `degraded: true` and still returns results
- [ ] `pnpm test` from the root runs the content and API tests
