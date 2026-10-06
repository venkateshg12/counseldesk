# Phase 22 — The eval runner and scoring

## 1. Goal

`pnpm --filter api eval --label baseline` runs every golden case through the **real** chat pipeline
(`handleMessage`, the same function the HTTP endpoint calls), scores it against its expectations, and
produces:

- a summary table in the terminal (retrieval hit rate, MRR, citation accuracy, fact accuracy,
  not-found accuracy, intent and refusal accuracy, lead accuracy, pass rate, latency percentiles,
  tokens, estimated cost);
- a Markdown and a JSON report under `apps/api/evals/results/`;
- `evalRun` and `evalResult` rows, so runs can be compared later.

## 2. What I will understand after this phase

1. How each metric is computed and what it can and can't tell you.
2. Why the runner calls the pipeline in-process instead of over HTTP.
3. How to stop evals having side effects (staff emails, staff queue entries).
4. Why LLM evals are noisy, and why you run the baseline more than once.

## 3. Prerequisites

- Phase 21 done: `eval:check` reports 0 problems.

## 4. Files

```
apps/api/
├── evals/results/                       NEW  committed reports (one .md + .json per run)
└── src/
    ├── prisma/contract.prisma           (EvalRun, EvalResult)
    ├── services/chat.service.ts         (notifyStaff option)
    ├── services/lead.service.ts         (notifyStaff option)
    ├── evals/metrics.ts                 NEW  pure scoring functions
    ├── evals/metrics.test.ts            NEW
    ├── evals/thresholds.ts              NEW  (used by the CI gate in Phase 29)
    └── evals/run.ts                     NEW
```

## 5. Concepts

**The metrics.**

| Metric             | Question it answers                                            | Computed over            |
| ------------------ | -------------------------------------------------------------- | ------------------------ |
| Retrieval hit@5    | Did any expected section make it into the 5 sources?           | cases with `sections`    |
| MRR                | How high was the first expected section? (1/rank, 0 if absent) | cases with `sections`    |
| Citation accuracy  | Did the answer cite an expected section?                       | cases with `sections`    |
| Invalid citations  | Citations to sources that weren't given                        | all answers              |
| Fact accuracy      | Does the answer contain every `mustInclude` string?            | cases with `mustInclude` |
| Not-found accuracy | Did unanswerable questions get the not-found sentence?         | `notFound` cases         |
| False not-found    | Did an answerable question wrongly get "not found"?            | answerable cases         |
| Intent accuracy    | Did the router label the last turn correctly?                  | all cases                |
| Refusal accuracy   | Were legal-advice traps refused?                               | legal-advice cases       |
| Lead accuracy      | Was the right lead (or none) saved, and the handoff created?   | wants-a-lawyer cases     |
| Pass rate          | Did every applicable check pass?                               | all cases                |

Separating retrieval from citation from facts tells you _where_ a failure is: a retrieval miss is a
search problem; a hit with a wrong citation is a prompt problem; right citation, wrong number is a
grounding problem.

**MRR.** Mean Reciprocal Rank: if the first expected section is 1st → 1, 2nd → 0.5, 3rd → 0.33, absent
→ 0, averaged. Hit@5 only says "somewhere in the top 5"; MRR rewards putting it at the top — which
matters because models lean on the first sources.

**In-process, through the real pipeline.** Calling `handleMessage` directly tests exactly what visitors
get (routing, retrieval, prompt, model, lead tools) without HTTP and rate limits in the way. Each case
runs inside a request context with its own request id (`eval-<run>-<case>`), so its `llmCall` rows can
be summed for tokens and cost.

**No side effects.** Lead cases would email staff and fill the handoff queue. `handleMessage` gets a
`notifyStaff` flag (default `true`) that the runner sets to `false`, and every eval conversation is
deleted after scoring (cascade removes messages, leads, handoffs). `llmCall` rows survive — their
`conversationId` becomes null (SetNull) — so token and cost totals remain.

**Noise.** The same prompt can produce different answers on two runs, even at low temperature, and
provider latency varies by the minute. Before trusting a difference between two configurations,
run the baseline twice and look at how much it moves by itself. A change smaller than that noise
isn't a result.

## 6. Steps

### Step 1 — Contract

```prisma
model EvalRun {
    id                  Uuid              @id @default(uuid())
    label               String
    subset              String            // "all" or "ci"
    searchMode          String
    splitDepth          Int
    answerPromptVersion String
    chatModel           String
    cases               Int
    passRate            Float
    retrievalHitRate    Float?
    mrr                 Float?
    citationRate        Float?
    factRate            Float?
    notFoundRate        Float?
    intentRate          Float
    refusalRate         Float?
    leadRate            Float?
    firstTokenP50       Int?
    firstTokenP95       Int?
    avgTokensPerCase    Int
    costMicros          Int
    createdAt           TimestamptzString @default(now())
    results             EvalResult[]
}

model EvalResult {
    id               Uuid    @id @default(uuid())
    runId            Uuid
    caseId           String
    category         String
    passed           Boolean
    intent           String?
    intentOk         Boolean
    retrievalHit     Boolean?
    reciprocalRank   Float?
    citationOk       Boolean?
    invalidCitations Int     @default(0)
    factsOk          Boolean?
    notFoundOk       Boolean?
    leadOk           Boolean?
    firstTokenMs     Int?
    totalMs          Int
    tokens           Int
    costMicros       Int
    answer           String
    error            String?
    run              EvalRun @relation(fields: [runId], references: [id], onDelete: Cascade)

    @@index([runId])
}
```

Nullable metrics mean "not applicable to this case" — different from `false`.

```bash
cd apps/api && pnpm db:plan add_eval_tables && pnpm db:sql && pnpm db:migrate
```

### Step 2 — `notifyStaff`

`lead.service.ts`: add `notifyStaff = true` to `runLeadStep`'s input and wrap the enqueue:
`if (created && notifyStaff) await enqueueNewLeadEmail(…)`. `chat.service.ts`: add
`notifyStaff?: boolean` to `HandleMessageInput` and pass it to `runLeadStep`.

### Step 3 — `src/evals/metrics.ts` (pure, tested)

```ts
import { isNotFoundReply } from "../utils/citations.js";
import type { EvalCase } from "./schema.js";

// "http://localhost:3000/fees#dui-fees" → "/fees#dui-fees"
export const toRef = (url: string) => {
  const { pathname, hash } = new URL(url);
  return `${pathname}${hash}`;
};

export const reciprocalRank = (retrieved: string[], expected: string[]) => {
  const index = retrieved.findIndex((ref) => expected.includes(ref));
  return index === -1 ? 0 : 1 / (index + 1);
};

export const containsAll = (text: string, needles: string[]) =>
  needles.every((needle) => text.toLowerCase().includes(needle.toLowerCase()));

const digits = (value: string | null | undefined) =>
  (value ?? "").replace(/\D/g, "");

type SavedLead = {
  name: string;
  caseType: string;
  phone: string | null;
  email: string | null;
} | null;

export const leadMatches = (
  expected: NonNullable<EvalCase["expect"]["lead"]>,
  saved: SavedLead,
) =>
  saved !== null &&
  saved.name.trim().toLowerCase() === expected.name.toLowerCase() &&
  saved.caseType === expected.caseType &&
  (!expected.phone || digits(saved.phone) === digits(expected.phone)) &&
  (!expected.email ||
    saved.email?.toLowerCase() === expected.email.toLowerCase());

export type CaseOutcome = {
  intent: string | null;
  answer: string;
  retrievedRefs: string[];
  citedRefs: string[];
  invalidCitations: number;
  lead: SavedLead;
  hasHandoff: boolean;
};

// Each check is null when it doesn't apply to the case.
export const scoreCase = (c: EvalCase, o: CaseOutcome) => {
  const { expect } = c;
  const intentOk = o.intent === expect.intent;
  const hasSections = Boolean(expect.sections?.length);

  const checks = {
    intentOk,
    retrievalHit: hasSections
      ? o.retrievedRefs.some((ref) => expect.sections!.includes(ref))
      : null,
    reciprocalRank: hasSections
      ? reciprocalRank(o.retrievedRefs, expect.sections!)
      : null,
    citationOk: hasSections
      ? o.citedRefs.some((ref) => expect.sections!.includes(ref))
      : null,
    factsOk: expect.mustInclude?.length
      ? containsAll(o.answer, expect.mustInclude)
      : null,
    notFoundOk:
      expect.notFound !== undefined
        ? isNotFoundReply(o.answer) === expect.notFound
        : c.category === "answerable"
          ? !isNotFoundReply(o.answer)
          : null,
    leadOk:
      expect.lead || expect.noLead || expect.handoff !== undefined
        ? (expect.lead ? leadMatches(expect.lead, o.lead) : true) &&
          (expect.noLead ? o.lead === null : true) &&
          (expect.handoff !== undefined
            ? o.hasHandoff === expect.handoff
            : true)
        : null,
  };

  const passed =
    intentOk &&
    o.invalidCitations === 0 &&
    [
      checks.retrievalHit,
      checks.citationOk,
      checks.factsOk,
      checks.notFoundOk,
      checks.leadOk,
    ].every((v) => v !== false);

  return { ...checks, passed };
};

export const rate = (values: (boolean | null)[]) => {
  const applicable = values.filter((v): v is boolean => v !== null);
  return applicable.length
    ? applicable.filter(Boolean).length / applicable.length
    : null;
};

export const percentile = (values: number[], p: number) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  ]!;
};
```

- For answerable cases without an explicit `notFound`, "not found" is a failure (`false not-found`):
  the system refused something it should have answered.
- `passed` requires zero invalid citations: citing a source that wasn't given is a fabricated
  reference.
- `percentile` uses the nearest-rank method — simple and exact enough for 52 values. (Postgres's
  `percentile_cont` interpolates, so Phase 20's numbers can differ slightly on small samples.)

### Step 4 — `src/evals/metrics.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  containsAll,
  leadMatches,
  percentile,
  rate,
  reciprocalRank,
  scoreCase,
  toRef,
} from "./metrics.js";
import type { EvalCase } from "./schema.js";

const base: EvalCase = {
  id: "x",
  category: "answerable",
  ci: false,
  turns: ["q"],
  expect: {
    intent: "question",
    sections: ["/fees#dui-fees"],
    mustInclude: ["2,500"],
  },
};

describe("metrics", () => {
  it("turns a citation URL into a page#anchor ref", () => {
    expect(toRef("http://localhost:3000/fees#dui-fees")).toBe("/fees#dui-fees");
    expect(toRef("https://site.example/#overview")).toBe("/#overview");
  });

  it("computes reciprocal rank", () => {
    expect(reciprocalRank(["/a#x", "/fees#dui-fees"], ["/fees#dui-fees"])).toBe(
      0.5,
    );
    expect(reciprocalRank(["/a#x"], ["/fees#dui-fees"])).toBe(0);
  });

  it("matches facts case-insensitively", () => {
    expect(
      containsAll("A flat fee from $2,500 [1].", ["2,500", "FLAT FEE"]),
    ).toBe(true);
    expect(containsAll("Fees vary.", ["2,500"])).toBe(false);
  });

  it("compares leads by name, case type and phone digits", () => {
    const saved = {
      name: " Ana Diaz ",
      caseType: "dui",
      phone: "(602) 555-0100",
      email: null,
    };
    expect(
      leadMatches(
        { name: "Ana Diaz", caseType: "dui", phone: "602-555-0100" },
        saved,
      ),
    ).toBe(true);
    expect(
      leadMatches({ name: "Ana Diaz", caseType: "family_law" }, saved),
    ).toBe(false);
    expect(leadMatches({ name: "Ana Diaz", caseType: "dui" }, null)).toBe(
      false,
    );
  });

  it("passes a fully correct answer and fails an invalid citation", () => {
    const outcome = {
      intent: "question",
      answer: "From $2,500 [1].",
      retrievedRefs: ["/fees#dui-fees"],
      citedRefs: ["/fees#dui-fees"],
      invalidCitations: 0,
      lead: null,
      hasHandoff: false,
    };
    expect(scoreCase(base, outcome).passed).toBe(true);
    expect(scoreCase(base, { ...outcome, invalidCitations: 1 }).passed).toBe(
      false,
    );
  });

  it("treats not-found on an answerable case as a failure", () => {
    const outcome = {
      intent: "question",
      answer: "I couldn't find that on our website.",
      retrievedRefs: [],
      citedRefs: [],
      invalidCitations: 0,
      lead: null,
      hasHandoff: false,
    };
    expect(scoreCase(base, outcome).notFoundOk).toBe(false);
  });

  it("ignores non-applicable checks in rates", () => {
    expect(rate([true, false, null])).toBe(0.5);
    expect(rate([null])).toBeNull();
  });

  it("computes nearest-rank percentiles", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
    expect(percentile([], 50)).toBeNull();
  });
});
```

### Step 5 — `src/evals/thresholds.ts`

```ts
// The CI gate (Phase 29). Set from your measured baseline minus a margin for noise — not from hopes.
// Refusals are held at 100%: a single answered legal-advice trap fails the build.
export const CI_THRESHOLDS = {
  intentRate: 0.9,
  refusalRate: 1,
  retrievalHitRate: 0.8,
  citationRate: 0.75,
  notFoundRate: 0.8,
  leadRate: 0.75,
};
```

Replace these numbers with your own once you have two baseline runs (Phase 23).

### Step 6 — `src/evals/run.ts`

```ts
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { ChatEvent } from "@repo/types";
import { loadCases } from "./loadCases.js";
import { percentile, rate, scoreCase, toRef } from "./metrics.js";
import { CI_THRESHOLDS } from "./thresholds.js";
import { handleMessage } from "../services/chat.service.js";
import { runWithRequestContext } from "../utils/requestContext.js";
import { db, orm, pool } from "../prisma/db.js";
import { closeDB } from "../config/db.js";
import { redisConnection } from "../jobs/redis/connection.js";
import { invalidCitationNumbers } from "../utils/citations.js";
import { ANSWER_PROMPT_VERSION, GEMINI_CHAT_MODEL } from "../constants/env.js";
import { SEARCH_MODES, type SearchMode } from "../constants/search.js";

// Usage: pnpm --filter api eval --label baseline [--subset ci] [--mode hybrid|keyword|vector] [--depth 3] [--case id] [--gate]
const { values } = parseArgs({
  options: {
    label: { type: "string", default: "run" },
    subset: { type: "string" },
    mode: { type: "string", default: "hybrid" },
    depth: { type: "string", default: "3" },
    case: { type: "string" },
    gate: { type: "boolean", default: false },
  },
});

const mode = values.mode as SearchMode;
if (!SEARCH_MODES.includes(mode))
  throw new Error(`--mode must be one of ${SEARCH_MODES.join(", ")}`);

let cases = loadCases({ subset: values.subset === "ci" ? "ci" : undefined });
if (values.case) cases = cases.filter((c) => c.id === values.case);

const runTag = Date.now().toString(36);
const results = [];

for (const evalCase of cases) {
  const requestId = `eval-${runTag}-${evalCase.id}`;
  const visitorId = requestId;
  let conversationId: string | undefined;
  let last: Awaited<ReturnType<typeof handleMessage>> | null = null;
  let error: string | null = null;
  const startedAt = performance.now();

  await runWithRequestContext({ requestId }, async () => {
    try {
      for (const turn of evalCase.turns) {
        const events: ChatEvent[] = [];
        last = await handleMessage({
          visitorId,
          conversationId,
          message: turn,
          signal: new AbortController().signal,
          emit: (event) => events.push(event),
          mode,
          notifyStaff: false,
        });
        conversationId = last?.conversationId;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  });

  const outcome = last as Awaited<ReturnType<typeof handleMessage>> | null;
  const sources = outcome?.prepared?.sources ?? [];
  const answer = outcome?.text ?? "";
  const [lead, handoff, usage] = await Promise.all([
    conversationId
      ? orm.Lead.where({ conversationId })
          .select("name", "caseType", "phone", "email")
          .first()
      : null,
    conversationId
      ? orm.Handoff.where({ conversationId }).select("id").first()
      : null,
    pool.query<{ tokens: string; cost: string }>(
      `SELECT coalesce(sum("inputTokens" + "outputTokens"), 0) AS tokens, coalesce(sum("costMicros"), 0) AS cost
       FROM "llmCall" WHERE "requestId" = $1`,
      [requestId],
    ),
  ]);

  const score = scoreCase(evalCase, {
    intent: outcome?.intent ?? null,
    answer,
    retrievedRefs: sources.map((s) => toRef(s.url)),
    citedRefs: (outcome?.citations ?? []).map((s) => toRef(s.url)),
    invalidCitations: invalidCitationNumbers(answer, sources).length,
    lead: lead ?? null,
    hasHandoff: Boolean(handoff),
  });

  results.push({
    caseId: evalCase.id,
    category: evalCase.category,
    ...score,
    passed: score.passed && !error,
    intent: outcome?.intent ?? null,
    invalidCitations: invalidCitationNumbers(answer, sources).length,
    firstTokenMs: outcome?.firstTokenMs ?? null,
    totalMs: Math.round(performance.now() - startedAt),
    tokens: Number(usage.rows[0]!.tokens),
    costMicros: Number(usage.rows[0]!.cost),
    answer,
    error,
  });
  console.log(
    `${score.passed && !error ? "PASS" : "FAIL"}  ${evalCase.id}${error ? `  (${error})` : ""}`,
  );

  // No side effects: the conversation (and its messages, lead, handoff) is removed after scoring.
  if (conversationId)
    await orm.Conversation.where({ id: conversationId }).deleteAll();
}

const firstTokens = results
  .map((r) => r.firstTokenMs)
  .filter((v): v is number => v !== null);
const summary = {
  label: values.label,
  subset: values.subset === "ci" ? "ci" : "all",
  searchMode: mode,
  splitDepth: Number(values.depth),
  answerPromptVersion: ANSWER_PROMPT_VERSION,
  chatModel: GEMINI_CHAT_MODEL,
  cases: results.length,
  passRate: rate(results.map((r) => r.passed))!,
  retrievalHitRate: rate(results.map((r) => r.retrievalHit)),
  mrr: (() => {
    const ranks = results
      .map((r) => r.reciprocalRank)
      .filter((v): v is number => v !== null);
    return ranks.length
      ? ranks.reduce((a, b) => a + b, 0) / ranks.length
      : null;
  })(),
  citationRate: rate(results.map((r) => r.citationOk)),
  factRate: rate(results.map((r) => r.factsOk)),
  notFoundRate: rate(results.map((r) => r.notFoundOk)),
  intentRate: rate(results.map((r) => r.intentOk))!,
  refusalRate: rate(
    results.filter((r) => r.category === "legal_advice").map((r) => r.intentOk),
  ),
  leadRate: rate(results.map((r) => r.leadOk)),
  firstTokenP50: percentile(firstTokens, 50),
  firstTokenP95: percentile(firstTokens, 95),
  avgTokensPerCase: Math.round(
    results.reduce((a, r) => a + r.tokens, 0) / Math.max(results.length, 1),
  ),
  costMicros: results.reduce((a, r) => a + r.costMicros, 0),
};

const run = await db.transaction(async (tx) => {
  const saved = await tx.orm.public.EvalRun.create(summary);
  for (const r of results)
    await tx.orm.public.EvalResult.create({ runId: saved.id, ...r });
  return saved;
});

const pct = (v: number | null) =>
  v === null ? "—" : `${(v * 100).toFixed(1)}%`;
const lines = [
  `# Eval run: ${summary.label}`,
  ``,
  `${new Date().toISOString()} · ${summary.cases} cases (${summary.subset}) · mode ${mode} · depth ${summary.splitDepth} · ${summary.answerPromptVersion} · ${summary.chatModel}`,
  ``,
  `| Metric | Value |`,
  `|---|---|`,
  `| Pass rate | ${pct(summary.passRate)} |`,
  `| Retrieval hit@5 | ${pct(summary.retrievalHitRate)} |`,
  `| MRR | ${summary.mrr?.toFixed(3) ?? "—"} |`,
  `| Citation accuracy | ${pct(summary.citationRate)} |`,
  `| Fact accuracy | ${pct(summary.factRate)} |`,
  `| Not-found accuracy | ${pct(summary.notFoundRate)} |`,
  `| Intent accuracy | ${pct(summary.intentRate)} |`,
  `| Refusal accuracy | ${pct(summary.refusalRate)} |`,
  `| Lead accuracy | ${pct(summary.leadRate)} |`,
  `| First token p50 / p95 | ${summary.firstTokenP50 ?? "—"} / ${summary.firstTokenP95 ?? "—"} ms |`,
  `| Tokens per case | ${summary.avgTokensPerCase} |`,
  `| Est. cost (list price) | $${(summary.costMicros / 1_000_000).toFixed(4)} |`,
  ``,
  `## Failures`,
  ...results
    .filter((r) => !r.passed)
    .map(
      (r) =>
        `- **${r.caseId}** (${r.category}): intent ${r.intent}; ${r.error ?? JSON.stringify({ retrieval: r.retrievalHit, citation: r.citationOk, facts: r.factsOk, notFound: r.notFoundOk, lead: r.leadOk, invalidCitations: r.invalidCitations })}\n  > ${r.answer.replace(/\n/g, " ").slice(0, 300)}`,
    ),
];

const dir = fileURLToPath(new URL("../../evals/results/", import.meta.url));
mkdirSync(dir, { recursive: true });
const file = `${dir}${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}-${summary.label}`;
writeFileSync(`${file}.md`, `${lines.join("\n")}\n`);
writeFileSync(
  `${file}.json`,
  JSON.stringify({ runId: run.id, summary, results }, null, 2),
);
console.log(`\n${lines.slice(4, 18).join("\n")}\n\nReport: ${file}.md`);

let gateFailed = false;
if (values.gate) {
  for (const [metric, minimum] of Object.entries(CI_THRESHOLDS)) {
    const value = summary[metric as keyof typeof CI_THRESHOLDS];
    if (value !== null && value < minimum) {
      console.error(`GATE: ${metric} ${pct(value)} is below ${pct(minimum)}`);
      gateFailed = true;
    }
  }
}

await redisConnection.quit();
await closeDB();
process.exit(gateFailed ? 1 : 0);
```

`package.json`: `"eval": "tsx src/evals/run.ts"`.

Things to notice:

- `--depth` records what you ingested; the runner doesn't re-ingest. Changing depth is `ingest
--depth 2` first (Phase 23).
- A thrown error (provider outage) fails the case instead of stopping the run; the error text goes in
  the report.
- Importing `handleMessage` loads the lead service, which imports the queue **producer** (and with it
  the Redis connection) but not the worker, so no jobs are processed by the eval process. The Redis
  connection is closed at the end so the process exits.
- The run's rows and reports are written once, at the end, in one transaction: a crashed run leaves
  nothing half-written.

## 7. Commit points

1. `feat(db): add eval run and result tables`
2. `feat(api): add notifyStaff option so evals have no side effects`
3. `feat(evals): add pure scoring functions with tests`
4. `feat(evals): add eval runner with reports and ci gate`

## 8. Verify

```bash
pnpm --filter api test                            # metrics tests pass
pnpm --filter api eval --label smoke --case fees-first-dui
pnpm --filter api eval --label smoke-ci --subset ci
pnpm --filter api eval --label baseline-1         # full set; a few minutes on free tiers
pnpm --filter api eval --label baseline-2         # again, to see the noise

ls apps/api/evals/results/                        # .md and .json per run
docker exec counseldesk-postgres psql -U counseldesk -d counseldesk -c \
  "SELECT label, cases, round(\"passRate\"::numeric,3) pass, round(\"retrievalHitRate\"::numeric,3) hit, \"firstTokenP50\" FROM \"evalRun\" ORDER BY \"createdAt\";"

# No side effects: no eval conversations or leads remain, no staff email jobs were queued
docker exec counseldesk-postgres psql -U counseldesk -d counseldesk -c "SELECT count(*) FROM conversation WHERE \"visitorId\" LIKE 'eval-%';"   # 0
docker exec counseldesk-redis redis-cli keys 'bull:notify-queue:lead:*'                                                                    # unchanged
```

Compare baseline-1 and baseline-2. The largest difference between them on any metric is your noise
floor — write it down; Phase 23 needs it.

## 9. Common mistakes

- **Scoring over HTTP.** Rate limits trip, and you test less of the pipeline's internals (retrieved
  refs).
- **Leaving eval leads in the database** — or worse, emailing staff 8 times per run.
- **Treating "not applicable" as "failed"** in rates. Only applicable checks count.
- **Comparing one run of A with one run of B.** Without the noise floor you'll "discover" improvements
  that are chance.
- **Editing `golden.json` between baseline and experiment.**

## 10. Interview prep

**Q: What metrics did you track and why?**
A: Retrieval hit@5 and MRR for search; citation accuracy and invalid citations for grounding; fact
accuracy against required facts; not-found accuracy and false not-founds for hallucination and
over-refusal; routing and refusal accuracy; lead-capture accuracy; plus p50/p95 first-token latency,
tokens and estimated cost. Splitting them shows which stage a failure comes from.

**Q: LLM outputs are non-deterministic — how do you trust eval numbers?**
A: I run the baseline twice to measure the noise floor and only treat differences larger than that as
real. Prompts and the dataset are versioned, and every run stores its configuration.

## 11. Resume-safe claim

"Built an automated evaluation harness running [N] golden conversations through the production pipeline,
scoring retrieval hit@5 [X]%, citation accuracy [Y]%, refusal accuracy [Z]% and lead-capture accuracy
[W]%, with run history stored for comparison."

## 12. Definition of done

- [ ] Metrics unit tests pass
- [ ] A full run writes a report, a JSON file and database rows
- [ ] No eval data or emails leak into the staff side
- [ ] Two baseline runs done; noise floor recorded
- [ ] Thresholds in `thresholds.ts` set from my baseline
