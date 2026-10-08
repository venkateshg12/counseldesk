import { orm } from "../prisma/db.js";
import { getRequestId } from "../utils/requestContext.js";
import { logger } from "../utils/logger.js";
import { MODEL_PRICES } from "../constants/pricing.js";

export type LlmCallRecord = {
  purpose: "route" | "answer" | "lead" | "embed_query" | "embed_document";
  provider: string;
  model: string;
  latencyMs: number;
  ok: boolean;
  conversationId?: string;
  promptVersion?: string;
  inputTokens?: number;
  outputTokens?: number;
  firstTokenMs?: number;
  fellBack?: boolean;
  errorCode?: string;
};

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

// Telemetry must never break the thing it measures: a failed insert is logged and swallowed.
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
