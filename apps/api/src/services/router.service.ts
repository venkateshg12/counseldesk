import { generateJson } from "../ai/llm.js";
import { routerV1, routeSchema } from "../ai/prompts/index.js";
import type { ChatMessage } from "../ai/types.js";
import { logger } from "../utils/logger.js";

// The router needs only recent context: the last exchange decides what "yes" means.
const ROUTER_CONTEXT_MESSAGES = 4;

export const routeMessage = async ({
  message,
  history,
  conversationId,
  signal,
}: {
  message: string;
  history: ChatMessage[];
  conversationId?: string;
  signal?: AbortSignal;
}) => {
  const startedAt = performance.now();
  const { data } = await generateJson({
    purpose: "route",
    promptVersion: routerV1.version,
    conversationId,
    signal,
    system: routerV1.system,
    messages: [
      ...history.slice(-ROUTER_CONTEXT_MESSAGES),
      { role: "user", content: message },
    ],
    schema: routeSchema,
  });

  logger.info("message routed", {
    intent: data.intent,
    conversationId,
  });
  return { ...data, routeMs: Math.round(performance.now() - startedAt) };
};
