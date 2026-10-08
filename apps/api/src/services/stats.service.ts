import { pool, orm } from "../prisma/db.js";
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
       FROM "LlmCall" WHERE "createdAt" >= $1
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
       FROM "Message"
       WHERE role = 'assistant' AND intent = 'question' AND "createdAt" >= $1`,
      [since],
    ),
    pool.query(
      `SELECT intent, count(*) AS messages FROM "Message"
       WHERE role = 'assistant' AND "createdAt" >= $1 GROUP BY intent ORDER BY 2 DESC`,
      [since],
    ),
    pool.query(
      `SELECT (SELECT count(*) FROM "Conversation" WHERE "createdAt" >= $1) AS conversations,
              (SELECT count(*) FROM "Lead"         WHERE "createdAt" >= $1) AS leads,
              (SELECT count(*) FROM "Handoff"      WHERE status = 'pending') AS pending_handoffs`,
      [since],
    ),
  ]);

  const answerRow = answers.rows[0] ?? {
    answers: "0",
    first_token_p50: null,
    first_token_p95: null,
    total_p50: null,
    total_p95: null,
    avg_route_ms: null,
    avg_retrieve_ms: null,
  };
  const totalRow = totals.rows[0] ?? {
    conversations: "0",
    leads: "0",
    pending_handoffs: "0",
  };

  return {
    days,
    pricesAsOf: PRICES_AS_OF,
    totals: Object.fromEntries(
      Object.entries(totalRow).map(([k, v]) => [k, Number(v)]),
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
    intents: intents.rows.map(
      (r: { intent: string | null; messages: string | number }) => ({
        intent: r.intent,
        messages: Number(r.messages),
      }),
    ),
    calls: calls.rows.map(
      (r: {
        purpose: string;
        provider: string;
        calls: string | number;
        errors: string | number;
        fallbacks: string | number;
        p50_ms: number | null;
        p95_ms: number | null;
        avg_input_tokens: number | null;
        avg_output_tokens: number | null;
        cost_micros: string | number | null;
      }) => ({
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
        estimatedCostUsd: Number(r.cost_micros ?? 0) / 1_000_000,
      }),
    ),
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
