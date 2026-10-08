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

type EvalCaseResult = ReturnType<typeof scoreCase> & {
  caseId: string;
  category: string;
  passed: boolean;
  intent: string | null;
  invalidCitations: number;
  firstTokenMs: number | null;
  totalMs: number;
  tokens: number;
  costMicros: number;
  answer: string;
  error: string | null;
};

const runTag = Date.now().toString(36);
const results: EvalCaseResult[] = [];

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
       FROM "LlmCall" WHERE "requestId" = $1`,
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
  label: values.label ?? "run",
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
