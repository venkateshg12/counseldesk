import { ZodError } from "zod";
// Gemini is switched off for now (NVIDIA is free); re-enable together with the provider list below.
// import { createGeminiProvider } from "./providers/gemini.js";
import { createNvidiaProvider } from "./providers/nvidia.js";
import { isBadModelOutput, isRetryable, withRetry } from "./reliability.js";
import type {
  ChatMessage,
  LlmProvider,
  StreamEvent,
  ToolSpec,
  Usage,
} from "./types.js";
import type { z } from "zod";
import {
  // GEMINI_CHAT_MODEL,
  // LLM_PRIMARY,
  LLM_PROVIDER,
  NVIDIA_CHAT_MODEL,
} from "../constants/env.js";
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
import { createFakeProvider } from "./providers/fake.js";

// Order is preference: the primary first, then fallbacks. NVIDIA only for now.
const providers: LlmProvider[] =
  LLM_PROVIDER === "fake"
    ? [createFakeProvider()]
    : [createNvidiaProvider(NVIDIA_CHAT_MODEL)];

// Gemini variant, kept for when it is switched back on (restore the imports above too):
// const providers: LlmProvider[] =
//   LLM_PROVIDER === "fake"
//     ? [createFakeProvider()]
//     : LLM_PRIMARY === "gemini"
//       ? [
//           createGeminiProvider(GEMINI_CHAT_MODEL),
//           createNvidiaProvider(NVIDIA_CHAT_MODEL),
//         ]
//       : [
//           createNvidiaProvider(NVIDIA_CHAT_MODEL),
//           createGeminiProvider(GEMINI_CHAT_MODEL),
//         ];

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
  if (isRetryable(error) || isBadModelOutput(error))
    logger.warn("llm provider failed, trying next", fields);
  else logger.error("llm provider failed, trying next", fields);
};

const unavailable = () =>
  new AppError(
    SERVICE_UNAVAILABLE,
    "The assistant is temporarily unavailable. Please try again shortly.",
    appErrorCode.LlmUnavailable,
  );

const runWithFallback = async <T>(
  meta: CallMeta,
  call: (
    provider: LlmProvider,
    signal: AbortSignal,
  ) => Promise<{ value: T; usage: Usage }>,
) => {
  for (const [index, provider] of providers.entries()) {
    const startedAt = performance.now();
    const base = {
      purpose: meta.purpose,
      provider: provider.name,
      model: provider.model,
      promptVersion: meta.promptVersion,
      conversationId: meta.conversationId,
      fellBack: index > 0,
    };

    try {
      const { value, usage } = await withRetry(
        (signal) => call(provider, signal),
        {
          attempts: JSON_ATTEMPTS,
          timeoutMs: JSON_TIMEOUT_MS,
          signal: meta.signal,
          // Structured calls also retry when the model's JSON is malformed or off-schema.
          retryIf: (error) => isRetryable(error) || isBadModelOutput(error),
        },
      );
      await recordLlmCall({
        ...base,
        ...usage,
        latencyMs: Math.round(performance.now() - startedAt),
        ok: true,
      });
      return { value, provider: provider.name, model: provider.model };
    } catch (error) {
      await recordLlmCall({
        ...base,
        latencyMs: Math.round(performance.now() - startedAt),
        ok: false,
        errorCode: errorCodeOf(error),
      });
      if (meta.signal?.aborted) throw error;
      logProviderFailure(provider, meta.purpose, error);
    }
  }
  throw unavailable();
};

export const generateJson = async <T>(
  request: {
    system: string;
    messages: ChatMessage[];
    schema: z.ZodType<T>;
  } & CallMeta,
) => {
  const { value, provider, model } = await runWithFallback(
    request,
    async (p, signal) => {
      const { data, usage } = await p.generateJson({
        system: request.system,
        messages: request.messages,
        schema: request.schema,
        signal,
      });
      return { value: data, usage };
    },
  );
  return { data: value, provider, model };
};

export const generateWithTools = async (
  request: {
    system: string;
    messages: ChatMessage[];
    tools: ToolSpec[];
  } & CallMeta,
) => {
  const { value } = await runWithFallback(request, async (p, signal) => {
    const { result, usage } = await p.callTools({
      system: request.system,
      messages: request.messages,
      tools: request.tools,
      signal,
    });
    return { value: result, usage };
  });
  return value;
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
