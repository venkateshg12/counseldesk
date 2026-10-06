# Phase 23 — Experiments: one change at a time

## 1. Goal

Use the eval suite the way the spec intends: change **one** thing, rerun, record before and after.
By the end you have a results table in `docs/results.md` with real numbers, a short written conclusion
for each experiment, a chosen final configuration, and a `docs/known-failures.md` with real examples
where the assistant went wrong.

Experiments (each is a single variable):

| #   | Variable       | Values                                     | Knob                       |
| --- | -------------- | ------------------------------------------ | -------------------------- |
| E1  | Search method  | hybrid / keyword / vector                  | `eval --mode`              |
| E2  | Section size   | depth 3 / depth 2                          | `ingest --depth`           |
| E3  | Keyword query  | OR of stems / AND (`websearch_to_tsquery`) | `KEYWORD_QUERY=or\|and`    |
| E4  | Prompt version | `answer.v1` / `answer.v2`                  | `ANSWER_PROMPT_VERSION`    |
| E5  | Thinking level | low / medium                               | `GEMINI_THINKING_LEVEL`    |
| E6  | Primary model  | Gemini / Groq                              | `LLM_PRIMARY=gemini\|groq` |

## 2. What I will understand after this phase

1. How to run a controlled experiment on an LLM system, and what "controlled" requires.
2. How to read a result against the noise floor.
3. The trade-offs each variable actually shows on _this_ data (not in general).
4. How to write up failures honestly and usefully.

## 3. Prerequisites

- Phase 22 done; two baseline runs recorded and the noise floor written down.

## 4. Files

```
apps/api/src/
├── constants/env.ts                 (KEYWORD_QUERY, GEMINI_THINKING_LEVEL, LLM_PRIMARY)
├── services/search.service.ts       (AND variant of the keyword query)
├── ai/providers/gemini.ts           (thinking level from env)
├── ai/llm.ts                        (provider order from env)
└── ai/prompts/answer.v2.ts          NEW
docs/
├── results.md                       NEW  the table and conclusions
└── known-failures.md                NEW
```

## 5. Concepts

**One variable.** If you change the prompt and the chunk size together and accuracy rises, you don't
know which helped — or whether one helped a lot while the other hurt. Every row in the table differs
from the baseline in exactly one knob. Knobs are environment variables or flags, so the code under test
is identical across runs.

**Fixed everything else.** Same `golden.json` (commit it before starting), same content, same models,
same day if possible (provider latency drifts). Latency comparisons in particular are only meaningful
between runs made close together.

**Noise floor.** Your two baselines differ by some amount on each metric by chance alone. A result is
"better" only if it beats the baseline by more than that. With 52 cases, one case is ~2 percentage
points; a 2-point change on one run is noise.

**Trade-offs, not winners.** Higher thinking might add a point of accuracy and double first-token
latency. Hybrid might beat vector by a few points of hit rate at the cost of one more query. The
write-up states both sides and which you chose for this product and why.

## 6. Steps

### Step 1 — The knobs

`env.ts`:

```ts
// Experiment knobs (Phase 23). Defaults are the chosen production configuration.
export const KEYWORD_QUERY = getEnv("KEYWORD_QUERY", "or");
export const GEMINI_THINKING_LEVEL = getEnv("GEMINI_THINKING_LEVEL", "low");
export const LLM_PRIMARY = getEnv("LLM_PRIMARY", "gemini");
```

`search.service.ts` — choose the tsquery expression:

```ts
import { KEYWORD_QUERY } from "../constants/env.js";

// OR of the question's stems (default), or websearch_to_tsquery's AND of every word.
const QUERY_EXPRESSION =
  KEYWORD_QUERY === "and"
    ? `websearch_to_tsquery('english', $1)`
    : `(SELECT to_tsquery('simple', string_agg(quote_literal(lexeme), ' | ')) FROM unnest(tsvector_to_array(to_tsvector('english', $1))) AS lexeme)`;

const KEYWORD_SQL = `
  WITH q AS (SELECT ${QUERY_EXPRESSION} AS query)
  SELECT s.id, ts_rank_cd(to_tsvector('english', s."searchText"), q.query) AS score
  FROM section s, q
  WHERE q.query IS NOT NULL
    AND to_tsvector('english', s."searchText") @@ q.query
  ORDER BY score DESC, s.id
  LIMIT $2
`;
```

`QUERY_EXPRESSION` is chosen from two literal strings in code at startup; nothing from a request is
ever interpolated.

`providers/gemini.ts` — read the level instead of hard-coding `LOW`:

```ts
import { GEMINI_THINKING_LEVEL } from "../../constants/env.js";

const THINKING_LEVELS: Record<string, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};
const thinkingLevel =
  THINKING_LEVELS[GEMINI_THINKING_LEVEL] ?? ThinkingLevel.LOW;
// …and use `thinkingConfig: { thinkingLevel }` in all three calls.
```

`llm.ts` — provider order:

```ts
import { LLM_PRIMARY } from "../constants/env.js";

const gemini = createGeminiProvider(GEMINI_CHAT_MODEL);
const groq = createGroqProvider(GROQ_CHAT_MODEL);
// Order is preference: the primary first, then the fallback.
const providers: LlmProvider[] =
  LLM_PRIMARY === "groq" ? [groq, gemini] : [gemini, groq];
```

Add the three variables, with their defaults, to `.env.example` under a "Phase 23: experiments"
heading.

### Step 2 — `answer.v2.ts`

Write v2 to fix something you **saw** in baseline failures, not a guess. A common one: a partially
answerable question ("What are your fees and do you validate parking?") gets a full not-found, or a
full answer that invents the missing half. Example v2, copied from v1 with these changes to the rules:

```ts
export const answerV2 = {
  version: "answer.v2",
  build(sources: Source[]) {
    // … same preamble and source block as v1 …
    // Rule 3 replaced:
    // 3. If the sources answer only part of the question, answer that part with citations, then say
    //    which part you couldn't find on the website. If they answer none of it, reply with exactly
    //    "${NOT_FOUND_REPLY}" and nothing else, then offer a free consultation on a new line.
    // Rule 7 added:
    // 7. When a source gives a number (a fee, a percentage, a deadline), quote it exactly as written.
  },
};
```

Register it in `ai/prompts/index.ts` next to v1. Never edit v1.

### Step 3 — Run the experiments

Commit `golden.json` and the code first, so every run is against the same commit. Then:

```bash
cd apps/api
# E1 — search method (no re-ingest needed)
pnpm eval --label E1-keyword --mode keyword
pnpm eval --label E1-vector  --mode vector
# hybrid = your baselines

# E2 — section size
pnpm ingest --depth 2 && pnpm eval --label E2-depth2 --depth 2
pnpm ingest --depth 3                               # back to baseline

# E3 — keyword query
KEYWORD_QUERY=and pnpm eval --label E3-and-hybrid
KEYWORD_QUERY=and pnpm eval --label E3-and-keyword --mode keyword

# E4 — prompt
ANSWER_PROMPT_VERSION=answer.v2 pnpm eval --label E4-answer-v2

# E5 — thinking
GEMINI_THINKING_LEVEL=medium pnpm eval --label E5-thinking-medium

# E6 — primary model
LLM_PRIMARY=groq pnpm eval --label E6-groq-primary
```

On a free tier, space runs out (or use `--subset ci` for a quick first look, then the full set for the
recorded number).

### Step 4 — `docs/results.md`

Fill this from the reports in `apps/api/evals/results/` — copy numbers, don't round them in your head.

```markdown
# Evaluation results

Dataset: 52 cases (commit <sha>). Content: 20 pages. Models: <gemini model>, fallback <groq model>.
Costs are estimates at paid-tier list prices as of <date>; on the free tier the actual cost was $0.
Noise floor (two baseline runs): ±<x> points on pass rate, ±<y> ms on first-token p50.

| Run                | Changed              | Pass | Hit@5 | MRR | Citation | Facts | Not-found | Intent | Refusal | Lead | FT p50 / p95 (ms) | Tokens/case | Cost/1k cases |
| ------------------ | -------------------- | ---- | ----- | --- | -------- | ----- | --------- | ------ | ------- | ---- | ----------------- | ----------- | ------------- |
| baseline-1         | —                    |      |       |     |          |       |           |        |         |      |                   |             |               |
| baseline-2         | —                    |      |       |     |          |       |           |        |         |      |                   |             |               |
| E1-keyword         | search: keyword only |      |       |     |          |       |           |        |         |      |                   |             |               |
| E1-vector          | search: vector only  |      |       |     |          |       |           |        |         |      |                   |             |               |
| E2-depth2          | sections: ## only    |      |       |     |          |       |           |        |         |      |                   |             |               |
| E3-and-hybrid      | keyword query: AND   |      |       |     |          |       |           |        |         |      |                   |             |               |
| E4-answer-v2       | prompt v2            |      |       |     |          |       |           |        |         |      |                   |             |               |
| E5-thinking-medium | thinking: medium     |      |       |     |          |       |           |        |         |      |                   |             |               |
| E6-groq-primary    | primary: Groq        |      |       |     |          |       |           |        |         |      |                   |             |               |

## Conclusions

- **E1:** <which search won on hit@5 and MRR, by how much vs. the noise floor; which cases flipped and why
  (e.g. `drunk-driving-synonym` needed vector; `phone-number` needed keyword)>
- **E2:** …
- …

## Chosen configuration

<the defaults now in .env.example, and one sentence each on why>
```

### Step 5 — `docs/known-failures.md`

For each failure that survives your chosen configuration, one entry:

```markdown
## <case id or short title>

- **Input:** "<the visitor's message(s)>"
- **Expected:** <what should have happened>
- **Got:** "<the actual answer, verbatim, trimmed>"
- **Why:** <your diagnosis: retrieval miss / wrong citation / router confusion / model ignored rule N>
- **Status:** <fixed in v2 | accepted because … | open: would need …>
```

Include at least one failure of each kind you found. A project that claims zero failures is a project
that didn't look; reviewers know that.

## 7. Commit points

1. `feat(api): add experiment knobs for keyword query, thinking level and primary model`
2. `feat(api): add answer prompt v2`
3. `docs: record experiment results and conclusions`
4. `docs: document known failures`

## 8. Verify

- Every run label in the table has a matching report file in `apps/api/evals/results/`.
- Each experiment row differs from baseline in exactly one knob (check the report headers: mode,
  depth, prompt, model).
- `docs/results.md` states the noise floor and the pricing date.
- Defaults in `env.ts` and `.env.example` equal the chosen configuration.

## 9. Common mistakes

- **Changing two things at once** "to save a run".
- **Declaring a 1–2 point change a win** on 52 cases with no repeat.
- **Tuning the prompt on the eval cases until they all pass.** That's overfitting: the prompt now
  memorises your test set. Fix _categories_ of failure you understand, and keep a few cases you never
  look at while tuning if you want an honest check.
- **Latency from runs hours apart.** Provider load changes; compare runs made together.
- **Deleting failing cases.** If a case is wrong, fix it in its own commit with a reason; if it's hard,
  keep it.

## 10. Interview prep

**Q: Tell me about an experiment you ran.**
A: (Use your numbers.) "Hybrid versus vector-only versus keyword-only on 52 cases: hybrid had hit@5 of
X vs Y vs Z, beyond the run-to-run noise of ±N. The synonym cases ('drunk driving' for DUI) failed
keyword-only, and exact tokens like the phone number failed vector-only; hybrid kept both."

**Q: How do you avoid overfitting prompts to your test set?**
A: Change prompts to fix a category of failure I can explain, never to flip one case; version every
prompt; and keep the dataset fixed while comparing.

**Q: What didn't work?**
A: (From known-failures.md — have one ready, with the diagnosis.)

## 11. Resume-safe claim

"Ran controlled single-variable experiments (search method, chunk size, query construction, prompt
version, reasoning level, model) on a [N]-case eval set; hybrid retrieval improved hit@5 from [A]% to
[B]% over [vector/keyword]-only, and documented remaining failure modes."

## 12. Definition of done

- [ ] Two baselines and six experiments run, each with a saved report
- [ ] `docs/results.md` filled with real numbers, the noise floor, and a conclusion per experiment
- [ ] Final configuration chosen and set as defaults
- [ ] `docs/known-failures.md` has real, diagnosed examples
