# Phase 14 — LLM provider adapter: Gemini, Groq, timeouts, retries, fallback

## 1. Goal

Build the one door every model call goes through. Services will call two functions:

- `generateJson(…)` — ask for a JSON object that must match a Zod schema (used by the intent router
  in Phase 17 and lead extraction in Phase 18);
- `streamText(…)` — stream an answer token by token (used by the chat in Phase 16).

Behind them: a common interface implemented for **Gemini** (primary) and **Groq** (fallback), a
timeout on every call, retries with exponential backoff and jitter for transient failures, fallback
to the other provider, and an `llmCall` row for every attempt. Services never import a provider SDK.

## 2. What I will understand after this phase

1. Why an adapter interface, and what it hides (message roles, schema formats, usage fields).
2. Which failures are worth retrying and which aren't.
3. What backoff with jitter is and what goes wrong without jitter.
4. Why a stream can only fall back **before** its first token.
5. What structured output is, and why the response is still validated with Zod.

## 3. Prerequisites

- Phase 13 done.
- A Groq API key (`GROQ_API_KEY`), and chat model ids chosen (Step 2).

## 4. Files

```
apps/api/src/
├── constants/env.ts               (chat models, Groq key)
├── constants/llm.ts               NEW  timeouts and attempts
├── constants/appErrorCode.ts      (LlmUnavailable)
├── ai/types.ts                    NEW  the provider interface
├── ai/reliability.ts              NEW  isRetryable, withRetry
├── ai/providers/gemini.ts         NEW
├── ai/providers/groq.ts           NEW
├── ai/llm.ts                      NEW  generateJson, streamText (fallback + telemetry)
└── scripts/llm-smoke.ts           NEW
```

## 5. Concepts

**Adapter.** Gemini calls the assistant role `model` and takes the system prompt as
`systemInstruction`; Groq uses OpenAI's format (`assistant`, a `system` message). Gemini reports
`promptTokenCount` / `candidatesTokenCount` / `thoughtsTokenCount`; Groq reports `prompt_tokens` /
`completion_tokens`. The interface (`LlmProvider`) has one shape for messages, results and usage; each
provider file translates. Adding or swapping a provider touches one file, and the eval suite can run
the same questions through either (the spec's "comparison in tests").

**What to retry.** Retry what might succeed on a second try: timeouts, network errors, `429 Too Many
Requests`, `5xx`. Don't retry what will fail identically: `400` (bad request), `401/403` (bad key),
`404` (unknown model). Never retry after the **client** disconnected: nobody is waiting for the answer.

**Backoff with jitter.** Waiting longer after each failure (exponential backoff) gives a struggling
provider room to recover. Jitter randomises the wait: with "full jitter" each wait is a random value
between 0 and the backoff cap. Without jitter, every client that failed at the same moment retries
at the same moment, and the provider gets hit by synchronised waves — the "thundering herd".

**One retry policy.** The Groq SDK retries twice by default (its docs: `maxRetries`, and timed-out
requests are retried). Our wrapper retries too. Stacked, 2 × 3 attempts become 6 calls on one
failure. The Groq client is created with `maxRetries: 0`, so our policy is the only one.

**Timeouts.** A hung request is worse than a failed one: it holds a connection and the visitor
waits. JSON calls get 15 s per attempt. Streams get two limits: 10 s to the **first token** (if the
model hasn't started by then, something is wrong) and 45 s overall (a long answer is fine; an
endless one isn't). Timeouts use `AbortSignal`, combined with the client's own signal through
`AbortSignal.any`, so one cancellation mechanism covers both.

**Fallback, and why streams are different.** If Gemini fails after its retries, try Groq. For JSON
calls that's always safe: nothing reached the visitor. For a stream, once the first words have been
sent to the browser, switching to another model would produce a different answer glued onto half of
the first. So a stream falls back only if it failed **before** its first token; after that, the error
ends the stream and the client shows "something went wrong" (Phase 34).

**Fallback on every failure, logged by kind.** Even a `401` (bad Gemini key) falls back, so the
visitor still gets an answer. But availability failures are logged as `warn` and everything else as
`error`, so a configuration bug shows up in the logs as an error instead of hiding behind a working
fallback.

**Structured output.** Gemini accepts a JSON Schema (`responseJsonSchema` with
`responseMimeType: "application/json"`) and constrains generation to it. The schema comes from the
same Zod schema the code validates with (`z.toJSONSchema`, built into Zod 4). Groq gets
`response_format: { type: "json_object" }` (valid JSON guaranteed) plus the schema in the prompt.
Either way the result is parsed with Zod: a model following a schema "mostly" is not the same as the
code being able to trust it. A Zod failure counts as a failed attempt and triggers the fallback.

**Thinking.** Current Gemini 3 Flash models reason before answering ("thinking"), by default at
`medium` or `high` depending on the model, per Google's docs. That adds latency and output tokens
(thinking tokens are billed as output). For routing and short grounded answers, `low` is the
documented low-latency setting. Phase 23 can measure `low` against `medium` on the golden set.

**Models (check current lists when you build this).** As of October 2026, Google's model page lists
`gemini-3.6-flash` (GA) and newer Flash models; Groq's production models include
`openai/gpt-oss-20b`. Pin an exact model id in `.env`, never an alias like `gemini-flash-latest`: an
alias can change under you and silently change your eval results. Pick a Gemini model with a free
tier in AI Studio, and check Groq's free-tier limits in its console.

## 6. Steps

### Step 1 — Install

```bash
pnpm --filter api add groq-sdk@^1.6.0
```

### Step 2 — Env and constants

`env.ts`:

```ts
export const GEMINI_CHAT_MODEL = getEnv("GEMINI_CHAT_MODEL");
export const GROQ_API_KEY = getEnv("GROQ_API_KEY");
export const GROQ_CHAT_MODEL = getEnv("GROQ_CHAT_MODEL");
```

`.env` (after checking the current model pages):

```bash
GEMINI_CHAT_MODEL=gemini-3.6-flash
GROQ_CHAT_MODEL=openai/gpt-oss-20b
```

`src/constants/llm.ts`:

```ts
// Per attempt, for JSON calls (routing, lead extraction).
export const JSON_TIMEOUT_MS = 15_000;
// Streams: the model must start within this, and finish within the overall limit.
export const FIRST_TOKEN_TIMEOUT_MS = 10_000;
export const STREAM_TIMEOUT_MS = 45_000;
// Attempts per provider for JSON calls, including the first.
export const JSON_ATTEMPTS = 2;
// Cap for one backoff wait.
export const MAX_BACKOFF_MS = 4_000;
```

`appErrorCode.ts`: add `LlmUnavailable = "LLM_UNAVAILABLE",`.

### Step 3 — `src/ai/types.ts`

```ts
import type { z } from "zod";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type Usage = { inputTokens: number; outputTokens: number };

export type StreamEvent =
  { type: "text"; text: string } | { type: "done"; usage: Usage };

export type JsonRequest<T> = {
  system: string;
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  signal: AbortSignal;
};

export type TextRequest = {
  system: string;
  messages: ChatMessage[];
  signal: AbortSignal;
};

// Every provider translates these shapes to and from its own SDK. Services never see an SDK type.
export interface LlmProvider {
  readonly name: "gemini" | "groq";
  readonly model: string;
  generateJson<T>(request: JsonRequest<T>): Promise<{ data: T; usage: Usage }>;
  streamText(request: TextRequest): AsyncIterable<StreamEvent>;
}
```

### Step 4 — `src/ai/reliability.ts`

```ts
import { MAX_BACKOFF_MS } from "../constants/llm.js";

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

// True for failures a second attempt might fix: timeouts, rate limits, server errors, network drops.
export const isRetryable = (error: unknown): boolean => {
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  )
    return true;

  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number") return RETRYABLE_STATUS.has(status);

  // No HTTP status at all: the request never got a response (DNS, reset, refused).
  const code = (error as { code?: unknown } | null)?.code;
  return (
    error instanceof TypeError || code === "ECONNRESET" || code === "ETIMEDOUT"
  );
};

// Full jitter: a random wait between 0 and the exponential cap, so clients don't retry in lockstep.
const backoffMs = (attempt: number) =>
  Math.random() * Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type RetryOptions = {
  attempts: number;
  timeoutMs: number;
  signal?: AbortSignal;
};

/*
  Runs fn up to `attempts` times. Each attempt gets its own timeout, combined with the caller's signal
  so a disconnected client cancels the attempt in flight. Stops immediately when the caller aborted
  or the error isn't worth retrying.
 */
export const withRetry = async <T>(
  fn: (signal: AbortSignal) => Promise<T>,
  { attempts, timeoutMs, signal }: RetryOptions,
) => {
  for (let attempt = 1; ; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const attemptSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      return await fn(attemptSignal);
    } catch (error) {
      if (signal?.aborted || attempt >= attempts || !isRetryable(error))
        throw error;
      await sleep(backoffMs(attempt));
    }
  }
};
```

- `AbortSignal.timeout(ms)` aborts with a `TimeoutError` after `ms`; `AbortSignal.any([...])` aborts
  when any of its signals does. Both are built into Node 20+.
- `signal?.aborted` is checked first: if the visitor closed the tab, we stop, even if the error looks
  retryable.

### Step 5 — `src/ai/providers/gemini.ts`

```ts
import {
  ThinkingLevel,
  type Content,
  type GenerateContentResponseUsageMetadata,
} from "@google/genai";
import { z } from "zod";
import { gemini } from "../gemini.js";
import type { ChatMessage, LlmProvider, Usage } from "../types.js";

const toContents = (messages: ChatMessage[]): Content[] =>
  messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

// Thinking tokens are billed as output, so they're counted as output.
const toUsage = (meta?: GenerateContentResponseUsageMetadata): Usage => ({
  inputTokens: meta?.promptTokenCount ?? 0,
  outputTokens:
    (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
});

// Gemini accepts a subset of JSON Schema; the "$schema" marker Zod adds isn't part of it.
const toResponseSchema = (schema: z.ZodType) => {
  const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema);
  return jsonSchema;
};

export const createGeminiProvider = (model: string): LlmProvider => ({
  name: "gemini",
  model,

  async generateJson({ system, messages, schema, signal }) {
    const response = await gemini.models.generateContent({
      model,
      contents: toContents(messages),
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        responseJsonSchema: toResponseSchema(schema),
        temperature: 0,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        abortSignal: signal,
      },
    });
    return {
      data: schema.parse(JSON.parse(response.text ?? "")),
      usage: toUsage(response.usageMetadata),
    };
  },

  async *streamText({ system, messages, signal }) {
    const stream = await gemini.models.generateContentStream({
      model,
      contents: toContents(messages),
      config: {
        systemInstruction: system,
        temperature: 0.2,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        abortSignal: signal,
      },
    });

    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    for await (const chunk of stream) {
      // Usage arrives on the last chunk; keep whatever was seen last.
      if (chunk.usageMetadata) usage = toUsage(chunk.usageMetadata);
      const text = chunk.text;
      if (text) yield { type: "text", text };
    }
    yield { type: "done", usage };
  },
});
```

- `temperature: 0` for JSON (classification should be as repeatable as possible); `0.2` for answers
  (slightly more natural wording while staying close to the sources).
- If TypeScript rejects `ThinkingLevel.LOW`, open `node_modules/@google/genai` types for the
  `ThinkingLevel` enum and use the member for "low" — the SDK docs list `thinkingLevel?: ThinkingLevel`
  on the thinking config.
- An empty response (`response.text` undefined, e.g. blocked by safety filters) becomes
  `JSON.parse("")`, which throws a `SyntaxError`: a failed attempt, so the fallback gets its turn.

### Step 6 — `src/ai/providers/groq.ts`

```ts
import Groq from "groq-sdk";
import { z } from "zod";
import { GROQ_API_KEY } from "../../constants/env.js";
import type { LlmProvider, Usage } from "../types.js";

// maxRetries: 0 — withRetry is the only retry policy (the SDK retries by default).
const groq = new Groq({ apiKey: GROQ_API_KEY, maxRetries: 0 });

type GroqUsage =
  { prompt_tokens?: number; completion_tokens?: number } | null | undefined;

const toUsage = (usage: GroqUsage): Usage => ({
  inputTokens: usage?.prompt_tokens ?? 0,
  outputTokens: usage?.completion_tokens ?? 0,
});

export const createGroqProvider = (model: string): LlmProvider => ({
  name: "groq",
  model,

  async generateJson({ system, messages, schema, signal }) {
    const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema);
    const completion = await groq.chat.completions.create(
      {
        model,
        temperature: 0,
        // Guarantees syntactically valid JSON; the shape is asked for in the prompt and checked by Zod.
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `${system}\n\nRespond with only a JSON object that matches this JSON Schema:\n${JSON.stringify(jsonSchema)}`,
          },
          ...messages,
        ],
      },
      { signal },
    );
    const content = completion.choices[0]?.message?.content ?? "";
    return {
      data: schema.parse(JSON.parse(content)),
      usage: toUsage(completion.usage),
    };
  },

  async *streamText({ system, messages, signal }) {
    const stream = await groq.chat.completions.create(
      {
        model,
        temperature: 0.2,
        stream: true,
        messages: [{ role: "system", content: system }, ...messages],
      },
      { signal },
    );

    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    for await (const chunk of stream) {
      // Usage is reported on the final chunk.
      const reported =
        (chunk as { usage?: GroqUsage; x_groq?: { usage?: GroqUsage } })
          .usage ?? chunk.x_groq?.usage;
      if (reported) usage = toUsage(reported);
      const text = chunk.choices[0]?.delta?.content;
      if (text) yield { type: "text", text };
    }
    yield { type: "done", usage };
  },
});
```

The Groq SDK also supports `response_format: { type: "json_schema", … }` (strict structured
outputs), but which models support it varies. `json_object` + Zod works with any JSON-capable model
and keeps the fallback dependable.

### Step 7 — `src/ai/llm.ts` — the only thing services import

```ts
import { ZodError } from "zod";
import { createGeminiProvider } from "./providers/gemini.js";
import { createGroqProvider } from "./providers/groq.js";
import { isRetryable, withRetry } from "./reliability.js";
import type { ChatMessage, LlmProvider, StreamEvent, Usage } from "./types.js";
import type { z } from "zod";
import { GEMINI_CHAT_MODEL, GROQ_CHAT_MODEL } from "../constants/env.js";
import {
  FIRST_TOKEN_TIMEOUT_MS,
  JSON_ATTEMPTS,
  JSON_TIMEOUT_MS,
  STREAM_TIMEOUT_MS,
} from "../constants/llm.js";
import { recordLlmCall } from "../services/llmCall.service.js";
import { AppError } from "../utils/errors/index.js";
import { SERVICE_UNAVAILABLE } from "../constants/http.js";
import { appErrorCode } from "../constants/appErrorCode.js";
import { logger } from "../utils/logger.js";

// Order is preference: the primary first, then fallbacks.
const providers: LlmProvider[] = [
  createGeminiProvider(GEMINI_CHAT_MODEL),
  createGroqProvider(GROQ_CHAT_MODEL),
];

type Purpose = "route" | "answer" | "lead";

type CallMeta = {
  purpose: Purpose;
  promptVersion: string;
  conversationId?: string;
  signal?: AbortSignal;
};

const errorCodeOf = (error: unknown) => {
  if (error instanceof ZodError) return "invalid_output";
  if (error instanceof SyntaxError) return "invalid_json";
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number") return `http_${status}`;
  return error instanceof Error ? error.name : "unknown";
};

// Availability problems are expected weather (warn); anything else is probably our bug (error).
const logProviderFailure = (
  provider: LlmProvider,
  purpose: Purpose,
  error: unknown,
) => {
  const fields = {
    provider: provider.name,
    model: provider.model,
    purpose,
    errorCode: errorCodeOf(error),
    error,
  };
  if (isRetryable(error))
    logger.warn("llm provider failed, trying next", fields);
  else logger.error("llm provider failed, trying next", fields);
};

const unavailable = () =>
  new AppError(
    SERVICE_UNAVAILABLE,
    "The assistant is temporarily unavailable. Please try again shortly.",
    appErrorCode.LlmUnavailable,
  );

export const generateJson = async <T>(
  request: {
    system: string;
    messages: ChatMessage[];
    schema: z.ZodType<T>;
  } & CallMeta,
) => {
  for (const [index, provider] of providers.entries()) {
    const startedAt = performance.now();
    const base = {
      purpose: request.purpose,
      provider: provider.name,
      model: provider.model,
      promptVersion: request.promptVersion,
      conversationId: request.conversationId,
      fellBack: index > 0,
    };

    try {
      const { data, usage } = await withRetry(
        (signal) =>
          provider.generateJson({
            system: request.system,
            messages: request.messages,
            schema: request.schema,
            signal,
          }),
        {
          attempts: JSON_ATTEMPTS,
          timeoutMs: JSON_TIMEOUT_MS,
          signal: request.signal,
        },
      );
      await recordLlmCall({
        ...base,
        ...usage,
        latencyMs: Math.round(performance.now() - startedAt),
        ok: true,
      });
      return { data, provider: provider.name, model: provider.model };
    } catch (error) {
      await recordLlmCall({
        ...base,
        latencyMs: Math.round(performance.now() - startedAt),
        ok: false,
        errorCode: errorCodeOf(error),
      });
      if (request.signal?.aborted) throw error;
      logProviderFailure(provider, request.purpose, error);
    }
  }
  throw unavailable();
};

export type StreamDone = {
  type: "done";
  usage: Usage;
  provider: string;
  model: string;
  firstTokenMs: number;
  fellBack: boolean;
};

/*
  Streams from the first provider that starts. Falls back only before the first token: after text
  has reached the visitor, switching models would splice two different answers together.
 */
export async function* streamText(
  request: { system: string; messages: ChatMessage[] } & CallMeta,
): AsyncGenerator<Extract<StreamEvent, { type: "text" }> | StreamDone> {
  for (const [index, provider] of providers.entries()) {
    const startedAt = performance.now();
    const controller = new AbortController();
    const firstTokenTimer = setTimeout(
      () =>
        controller.abort(new DOMException("No first token", "TimeoutError")),
      FIRST_TOKEN_TIMEOUT_MS,
    );
    const totalTimer = setTimeout(
      () =>
        controller.abort(new DOMException("Stream too long", "TimeoutError")),
      STREAM_TIMEOUT_MS,
    );
    const signal = request.signal
      ? AbortSignal.any([request.signal, controller.signal])
      : controller.signal;
    let firstTokenMs: number | undefined;

    const base = {
      purpose: request.purpose,
      provider: provider.name,
      model: provider.model,
      promptVersion: request.promptVersion,
      conversationId: request.conversationId,
      fellBack: index > 0,
    };

    try {
      for await (const event of provider.streamText({
        system: request.system,
        messages: request.messages,
        signal,
      })) {
        if (event.type === "text") {
          if (firstTokenMs === undefined) {
            firstTokenMs = Math.round(performance.now() - startedAt);
            clearTimeout(firstTokenTimer);
          }
          yield event;
          continue;
        }

        const latencyMs = Math.round(performance.now() - startedAt);
        await recordLlmCall({
          ...base,
          ...event.usage,
          latencyMs,
          firstTokenMs,
          ok: true,
        });
        yield {
          type: "done",
          usage: event.usage,
          provider: provider.name,
          model: provider.model,
          firstTokenMs: firstTokenMs ?? latencyMs,
          fellBack: index > 0,
        };
        return;
      }
    } catch (error) {
      await recordLlmCall({
        ...base,
        latencyMs: Math.round(performance.now() - startedAt),
        firstTokenMs,
        ok: false,
        errorCode: errorCodeOf(error),
      });
      if (request.signal?.aborted) return; // the visitor left; nothing to do
      if (firstTokenMs !== undefined) throw error; // text already sent: can't switch models now
      logProviderFailure(provider, request.purpose, error);
    } finally {
      clearTimeout(firstTokenTimer);
      clearTimeout(totalTimer);
    }
  }
  throw unavailable();
}
```

What to notice:

- Every attempt, successful or not, writes one `llmCall` row with `fellBack` set when it isn't the
  primary. Phase 20's "fallback rate" is a count of these.
- The JSON path retries **within** a provider (`withRetry`) and then falls back **across**
  providers. The stream path doesn't retry within a provider — a stream that failed to start within
  10 s is better handed to the fallback than retried.
- When every provider fails, the caller gets a 503 `AppError` with `LLM_UNAVAILABLE`. The error
  handler turns it into an envelope; Phase 16 turns it into an SSE error event.

### Step 8 — `src/scripts/llm-smoke.ts`

```ts
import "dotenv/config";
import { z } from "zod";
import { generateJson, streamText } from "../ai/llm.js";
import { closeDB } from "../config/db.js";

const verdict = await generateJson({
  purpose: "route",
  promptVersion: "smoke",
  system: "Classify the sentiment of the user's message.",
  messages: [{ role: "user", content: "I love how fast this is!" }],
  schema: z.object({ sentiment: z.enum(["positive", "neutral", "negative"]) }),
});
console.log("json:", verdict);

process.stdout.write("stream: ");
for await (const event of streamText({
  purpose: "answer",
  promptVersion: "smoke",
  system: "Answer in one short sentence.",
  messages: [{ role: "user", content: "Why is the sky blue?" }],
})) {
  if (event.type === "text") process.stdout.write(event.text);
  else
    console.log(
      `\n[${event.provider}/${event.model}] first token ${event.firstTokenMs} ms, tokens in/out ${event.usage.inputTokens}/${event.usage.outputTokens}${event.fellBack ? " (fallback)" : ""}`,
    );
}

await closeDB();
```

`package.json`: `"llm:smoke": "tsx src/scripts/llm-smoke.ts"`.

## 7. Commit points

1. `feat(api): add llm provider interface and retry with jittered backoff`
2. `feat(api): add gemini and groq providers with structured json output`
3. `feat(api): add llm facade with fallback, timeouts and call telemetry`
4. `chore(api): add llm smoke script`

## 8. Verify

```bash
pnpm --filter api llm:smoke
# json: { data: { sentiment: 'positive' }, provider: 'gemini', model: 'gemini-3.6-flash' }
# stream: The sky looks blue because …
# [gemini/gemini-3.6-flash] first token 6xx ms, tokens in/out 1x/2x

# Fallback: break the primary model id
GEMINI_CHAT_MODEL=not-a-model pnpm --filter api llm:smoke
# ERROR llm provider failed, trying next {"provider":"gemini","errorCode":"http_404",…}   ← error, not warn
# json: { …, provider: 'groq', … }
# stream: … [groq/openai/gpt-oss-20b] … (fallback)

# Both broken → 503-style AppError
GEMINI_CHAT_MODEL=not-a-model GROQ_CHAT_MODEL=not-a-model pnpm --filter api llm:smoke
# AppError: The assistant is temporarily unavailable…

# Telemetry rows, including failed attempts
docker exec counseldesk-postgres psql -U counseldesk -d counseldesk -c \
  "SELECT purpose, provider, ok, \"fellBack\", \"errorCode\", \"latencyMs\", \"firstTokenMs\", \"inputTokens\", \"outputTokens\" FROM \"llmCall\" WHERE purpose <> 'embed_document' ORDER BY \"createdAt\" DESC LIMIT 8;"

# Timeout path: temporarily set FIRST_TOKEN_TIMEOUT_MS to 50 → Gemini times out (warn, TimeoutError),
# Groq usually starts in time. Restore it afterwards.
```

## 9. Common mistakes

- **Leaving the Groq SDK's default retries on.** Retries multiply and the visitor waits through all
  of them.
- **Retrying 400s.** They fail the same way every time; you only add latency.
- **Falling back mid-stream.** Two answers spliced together, and the citations of neither make sense.
- **Trusting structured output without Zod.** Schema-constrained generation is a strong hint, not a
  guarantee your code can rely on — and the fallback provider has no constraint at all.
- **Pinning an alias** (`…-latest`) as the model. Your evals change when the alias moves.
- **Timeout without abort.** A `Promise.race` timeout returns early but leaves the HTTP request
  running and billing. Pass the signal to the SDK so the request is actually cancelled.

## 10. Interview prep

**Q: How do you handle a slow or flaky LLM provider?**
A: Every call has a timeout via an AbortSignal passed to the SDK, so it's really cancelled. Transient
failures (timeouts, 429, 5xx, network) are retried with exponential backoff and full jitter; then the
call falls back to a second provider. SDK-level retries are disabled so there's exactly one policy.
Every attempt is logged with provider, latency, tokens and error code.

**Q: Why can't you fall back in the middle of a stream?**
A: The visitor has already seen part of the first model's answer; continuing with another model would
splice two different texts. Streams fall back only before the first token, which a first-token
timeout bounds.

**Q: How do you get reliable JSON from a model?**
A: Schema-constrained output where the provider supports it (Gemini's JSON-schema response), JSON
mode elsewhere, and always a Zod parse of the result. A parse failure counts as a failed attempt and
triggers the fallback.

**Q: Why jitter?**
A: Without it, every client that failed together retries together, and the recovering provider gets
hit by synchronised waves. Randomising the wait spreads them out.

## 11. Resume-safe claim

"Built a provider-agnostic LLM layer (Gemini primary, Groq fallback) with per-call timeouts,
jittered retries on transient errors, pre-first-token stream fallback, Zod-validated structured
output, and per-attempt telemetry."

## 12. Definition of done

- [ ] `llm:smoke` returns valid JSON and a streamed sentence from Gemini
- [ ] A broken primary model falls back to Groq, logged at `error` level
- [ ] Both broken → `LLM_UNAVAILABLE`
- [ ] `llmCall` has a row per attempt with tokens, latency and (for streams) first-token time
- [ ] No service file imports `@google/genai` or `groq-sdk` directly (`grep -rn "groq-sdk\|@google/genai" apps/api/src/services` is empty)
