# Phase 20 — Observability: cost, tokens, latency and per-request traces

## 1. Goal

Turn the `llmCall` rows and message timings into answers to the questions anyone running an AI feature
gets asked:

- How long does an answer take — median and slowest 5% — and where does the time go (routing,
  retrieval, first token, generation)?
- How many tokens per answer, and what would this cost at paid-tier prices?
- How often does the primary provider fail, and how often do we fall back?
- For one specific slow or wrong answer: what exactly happened, call by call?

Delivered as `GET /staff/stats?days=7`, `GET /staff/traces/:messageId`, and a terminal report
(`pnpm --filter api report`). The eval runner (Phase 22) reuses the same numbers.

## 2. What I will understand after this phase

1. Why percentiles (p50, p95) and not averages for latency.
2. How token usage turns into money, and why cost is stored as integer micro-dollars.
3. What a trace is, and how one request id ties a message to every model call it caused.
4. Why "time to first token" is the latency that matters for a streaming chat.

## 3. Prerequisites

- Phase 19 done.
- The current pricing pages of Google AI and Groq open (Step 2).

## 4. Files

```
apps/api/src/
├── prisma/contract.prisma          (Message.requestId, Message.routeMs; index on llmCall.requestId)
├── constants/pricing.ts            NEW  USD per 1M tokens, per model, with a date
├── services/llmCall.service.ts     (costMicros computed on record)
├── services/chat.service.ts        (save requestId and routeMs)
├── services/stats.service.ts       NEW  getStats, getTrace
├── controllers/staff.controller.ts (statsHandler, traceHandler)
├── routes/staff.route.ts           (two routes)
└── scripts/report.ts               NEW
```

## 5. Concepts

**Percentiles, not averages.** If 19 answers take 1 s and one takes 21 s, the average is 2 s — a number
no visitor experienced. The **p50** (median) is what a typical visitor sees; the **p95** is the
experience of the unluckiest one in twenty, which is where timeouts, fallbacks and cold starts show up.
Postgres computes them with `percentile_cont(0.95) WITHIN GROUP (ORDER BY …)`.

**Time to first token.** In a streaming UI the visitor starts reading at the first word. A 6-second
answer whose first word arrives at 800 ms feels fast; a 3-second answer that shows nothing until the
end feels slow. So the chat's headline latency is first token, measured from when the request arrived
(routing + retrieval + model start). Total time still matters for cost and for proxies' timeouts.

**Cost arithmetic.** Providers price per million tokens, in USD: say $0.30 per 1M input tokens. One
input token then costs 0.30 / 1,000,000 USD = 0.30 **micro**-dollars. So a price "per 1M tokens in
USD" is exactly "micro-dollars per token", and

```
costMicros = inputTokens × inputPricePer1M + outputTokens × outputPricePer1M
```

needs no division at all. Stored as an integer (rounded per call), sums never drift.

**Free tier vs list price.** On the free tiers the real bill is zero. The number reported is what the
same traffic would cost at **paid-tier list prices** — the figure that matters when someone asks "what
would this cost with real users". The report says so in its heading. Thinking tokens are billed as
output (Google's pricing page lists "output price (including thinking tokens)"), which is why Phase 14
adds them to `outputTokens`.

**Traces.** A trace is everything one request did, in order. Every `llmCall` row already carries the
request id (Phase 02 → Phase 11's `recordLlmCall`). Saving the same id on the assistant message
links them: "message X" → its request id → the route call, the query embedding, the answer call (and
any failed attempts and fallbacks), each with its own latency. No tracing library needed for a
single service; OpenTelemetry becomes worth it when one request crosses several services.

## 6. Steps

### Step 1 — Contract

`Message`:

```prisma
    // The request that produced this message: joins it to its llmCall rows (a trace).
    requestId      String?
    routeMs        Int?
```

with `@@index([requestId])` on `Message`, and `@@index([requestId])` added to `LlmCall`.

```bash
cd apps/api && pnpm db:plan add_trace_columns && pnpm db:sql && pnpm db:migrate
```

### Step 2 — `src/constants/pricing.ts`

Fill this from the providers' pricing pages **on the day you build it**, and keep the date: prices
change, and the report is only meaningful with the date next to it. Values below are the ones read from
the official pages while this plan was written; models without a verified number are left for you.

```ts
// USD per 1M tokens, paid tier, standard (non-batch) pricing. Read on: 2026-10-06. Update with the date.
// Because "USD per 1M tokens" equals "micro-USD per token", these multiply token counts directly.
export const PRICES_AS_OF = "2026-10-06";

export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  // https://ai.google.dev/gemini-api/docs/pricing — output includes thinking tokens.
  "gemini-3.5-flash": { input: 1.5, output: 9.0 },
  // Fill in for the model you actually use, e.g. "gemini-3.6-flash", from the same page.
  // "gemini-embedding-2": { input: …, output: 0 },
  // https://console.groq.com/docs/models
  "openai/gpt-oss-20b": { input: 0.075, output: 0.3 },
};
```

### Step 3 — Cost on record

In `llmCall.service.ts`:

```ts
import { MODEL_PRICES } from "../constants/pricing.js";

const warnedModels = new Set<string>();

const costMicrosOf = (model: string, inputTokens = 0, outputTokens = 0) => {
  const price = MODEL_PRICES[model];
  if (!price) {
    if (!warnedModels.has(model)) {
      warnedModels.add(model);
      logger.warn("no price configured for model; cost recorded as 0", {
        model,
      });
    }
    return 0;
  }
  return Math.round(inputTokens * price.input + outputTokens * price.output);
};

export const recordLlmCall = async (call: LlmCallRecord) => {
  try {
    await orm.LlmCall.create({
      ...call,
      costMicros: costMicrosOf(call.model, call.inputTokens, call.outputTokens),
      requestId: getRequestId(),
    });
  } catch (error) {
    logger.error("failed to record llm call", { error, purpose: call.purpose });
  }
};
```

Remove `costMicros` from the `LlmCallRecord` type: callers no longer pass it.

### Step 4 — Save `requestId` and `routeMs` on assistant messages

In every `Message.create` for `role: "assistant"` in `chat.service.ts`, add
`requestId: getRequestId()` (from `../utils/requestContext.js`) and `routeMs: route.routeMs`.

### Step 5 — `src/services/stats.service.ts`

```ts
import { pool } from "../prisma/db.js";
import { orm } from "../prisma/db.js";
import { appAssert } from "../utils/errors/index.js";
import { NOT_FOUND } from "../constants/http.js";
import { PRICES_AS_OF } from "../constants/pricing.js";

const round = (value: unknown) =>
  value === null || value === undefined ? null : Math.round(Number(value));

export const getStats = async (days: number) => {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const [calls, answers, intents, totals] = await Promise.all([
    // Per purpose and provider: volume, reliability, latency percentiles, tokens, cost.
    pool.query(
      `SELECT purpose, provider,
              count(*)                                                   AS calls,
              count(*) FILTER (WHERE NOT ok)                             AS errors,
              count(*) FILTER (WHERE "fellBack")                         AS fallbacks,
              percentile_cont(0.5)  WITHIN GROUP (ORDER BY "latencyMs")  AS p50_ms,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs")  AS p95_ms,
              avg("inputTokens")                                         AS avg_input_tokens,
              avg("outputTokens")                                        AS avg_output_tokens,
              sum("costMicros")                                          AS cost_micros
       FROM "llmCall" WHERE "createdAt" >= $1
       GROUP BY purpose, provider ORDER BY purpose, provider`,
      [since],
    ),
    // What the visitor experiences, per answered (question-intent) message.
    pool.query(
      `SELECT count(*) AS answers,
              percentile_cont(0.5)  WITHIN GROUP (ORDER BY "firstTokenMs") AS first_token_p50,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY "firstTokenMs") AS first_token_p95,
              percentile_cont(0.5)  WITHIN GROUP (ORDER BY "totalMs")      AS total_p50,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY "totalMs")      AS total_p95,
              avg("routeMs")    AS avg_route_ms,
              avg("retrieveMs") AS avg_retrieve_ms
       FROM message
       WHERE role = 'assistant' AND intent = 'question' AND "createdAt" >= $1`,
      [since],
    ),
    pool.query(
      `SELECT intent, count(*) AS messages FROM message
       WHERE role = 'assistant' AND "createdAt" >= $1 GROUP BY intent ORDER BY 2 DESC`,
      [since],
    ),
    pool.query(
      `SELECT (SELECT count(*) FROM conversation WHERE "createdAt" >= $1) AS conversations,
              (SELECT count(*) FROM lead         WHERE "createdAt" >= $1) AS leads,
              (SELECT count(*) FROM handoff      WHERE status = 'pending') AS pending_handoffs`,
      [since],
    ),
  ]);

  const answerRow = answers.rows[0];
  return {
    days,
    pricesAsOf: PRICES_AS_OF,
    totals: Object.fromEntries(
      Object.entries(totals.rows[0]).map(([k, v]) => [k, Number(v)]),
    ),
    answers: {
      count: Number(answerRow.answers),
      firstTokenP50: round(answerRow.first_token_p50),
      firstTokenP95: round(answerRow.first_token_p95),
      totalP50: round(answerRow.total_p50),
      totalP95: round(answerRow.total_p95),
      avgRouteMs: round(answerRow.avg_route_ms),
      avgRetrieveMs: round(answerRow.avg_retrieve_ms),
    },
    intents: intents.rows.map((r) => ({
      intent: r.intent,
      messages: Number(r.messages),
    })),
    calls: calls.rows.map((r) => ({
      purpose: r.purpose,
      provider: r.provider,
      calls: Number(r.calls),
      errorRate: Number(r.errors) / Number(r.calls),
      fallbackRate: Number(r.fallbacks) / Number(r.calls),
      p50Ms: round(r.p50_ms),
      p95Ms: round(r.p95_ms),
      avgInputTokens: round(r.avg_input_tokens),
      avgOutputTokens: round(r.avg_output_tokens),
      // Estimated at paid-tier list prices; see pricesAsOf.
      estimatedCostUsd: Number(r.cost_micros) / 1_000_000,
    })),
  };
};

// Everything one answer did, in order.
export const getTrace = async (messageId: string) => {
  const message = await orm.Message.where({ id: messageId })
    .select(
      "id",
      "conversationId",
      "intent",
      "requestId",
      "routeMs",
      "retrieveMs",
      "firstTokenMs",
      "totalMs",
      "createdAt",
    )
    .first();
  appAssert(message, NOT_FOUND, "Message not found");

  const calls = message.requestId
    ? await orm.LlmCall.where({ requestId: message.requestId })
        .orderBy((c) => c.createdAt.asc())
        .select(
          "purpose",
          "provider",
          "model",
          "promptVersion",
          "ok",
          "fellBack",
          "errorCode",
          "latencyMs",
          "firstTokenMs",
          "inputTokens",
          "outputTokens",
          "costMicros",
          "createdAt",
        )
        .all()
    : [];

  return { message, calls };
};
```

`FILTER (WHERE …)` counts a subset inside one `GROUP BY` pass — cheaper and clearer than three
queries. The pricing caveat travels with the numbers (`pricesAsOf`), not just in documentation.

### Step 6 — Endpoints

Controller:

```ts
import { z } from "zod";
import { getStats, getTrace } from "../services/stats.service.js";

const statsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});

export const statsHandler = catchError(async (req, res) => {
  const { days } = statsQuerySchema.parse(req.query);
  res.status(OK).json(ok(await getStats(days)));
});

export const traceHandler = catchError(async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  res.status(OK).json(ok(await getTrace(id)));
});
```

Routes (under the existing authenticated staff router):

```ts
staffRoutes.get("/stats", statsHandler);
staffRoutes.get("/traces/:messageId", traceHandler);
```

(Rename the param to `id` in the route, `/traces/:id`, so `idParamSchema` reads it.)

### Step 7 — `src/scripts/report.ts`

```ts
import "dotenv/config";
import { parseArgs } from "node:util";
import { getStats } from "../services/stats.service.js";
import { closeDB } from "../config/db.js";

const { values } = parseArgs({
  options: { days: { type: "string", default: "7" } },
});
const stats = await getStats(Number(values.days));

console.log(
  `\nLast ${stats.days} day(s) — cost estimated at paid-tier list prices as of ${stats.pricesAsOf}\n`,
);
console.log("Totals:", stats.totals);
console.log("\nAnswers (question intent), ms:");
console.table([stats.answers]);
console.log("Messages by intent:");
console.table(stats.intents);
console.log("Model calls:");
console.table(stats.calls);

await closeDB();
```

`package.json`: `"report": "tsx src/scripts/report.ts"`.

## 7. Commit points

1. `feat(db): link messages to requests and record routing time`
2. `feat(api): estimate cost per llm call from a dated price table`
3. `feat(api): add staff stats with latency percentiles, fallback and error rates`
4. `feat(api): add per-message trace endpoint and terminal report`

## 8. Verify

```bash
# Generate some traffic: 10 questions, 3 refusals, 1 lead flow (Phases 16–18 commands)
pnpm --filter api report --days 1
# Model calls table: route / answer / embed_query rows with p50/p95 and estimated cost
# Answers: first-token p50 should be well below total p50

curl -s -b /tmp/cd-cookies "localhost:4000/staff/stats?days=1" | jq '.data.answers'

# Trace one answer
MID=$(docker exec counseldesk-postgres psql -U counseldesk -d counseldesk -tAc "SELECT id FROM message WHERE role='assistant' AND intent='question' ORDER BY \"createdAt\" DESC LIMIT 1")
curl -s -b /tmp/cd-cookies "localhost:4000/staff/traces/$MID" | jq '.data.calls[] | {purpose, provider, latencyMs, ok, fellBack}'
# route → embed_query → answer, in order; a forced fallback (Phase 14 trick) shows a failed gemini row then groq

# Cost arithmetic by hand for one row: inputTokens × input price + outputTokens × output price = costMicros
```

Record the first real numbers now — p50/p95 first token, router share of latency, tokens per answer,
estimated cost per 1,000 answers. They are the "before" of Phase 23.

## 9. Common mistakes

- **Reporting averages.** They hide the slow tail that visitors complain about.
- **Floats for money.** Sum a million float costs and the cents drift.
- **A price table without a date.** Next month nobody knows whether "$0.04 per 1,000 answers" is still
  true.
- **Forgetting thinking tokens** in output tokens. Cost is understated, sometimes by a lot.
- **Measuring first token from the start of the model call only.** The visitor also waited for the
  router and retrieval.

## 10. Interview prep

**Q: How do you measure the latency of your AI feature?**
A: Per request: routing, retrieval, time to first token and total, stored on the message; per model
call: latency and first-token time in a call log. I report p50 and p95, because averages hide the tail.
For a streaming chat, first-token latency is the headline number.

**Q: How do you know what it costs?**
A: Every call records input and output tokens (thinking tokens counted as output). A dated price table
turns them into integer micro-dollars at paid-tier list prices, and the report aggregates by purpose and
provider, so I can say what 1,000 answers cost and which step costs most.

**Q: How do you debug one bad answer?**
A: Its message row holds the request id; every model call of that request carries the same id. The
trace endpoint lists them in order with provider, prompt version, latency, tokens and errors.

## 11. Resume-safe claim

"Instrumented the assistant end to end — p50 first-token latency [X] ms, p95 [Y] ms, ~[Z] tokens and
$[C] estimated per 1,000 answers at list prices — with per-request traces linking each answer to its
model calls."

## 12. Definition of done

- [ ] `report` prints per-purpose percentiles, error/fallback rates and estimated cost
- [ ] `/staff/stats` and `/staff/traces/:id` work behind login
- [ ] A trace shows every call of one answer, in order
- [ ] The price table has today's date and your actual models
- [ ] I've recorded the first real numbers
