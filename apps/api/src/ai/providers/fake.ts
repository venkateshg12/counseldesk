import type { LlmProvider, StreamEvent, ToolResult, Usage } from "../types.js";
import { routerV1 } from "../prompts/index.js";

type Scripted =
  | { kind: "json"; data: unknown }
  | { kind: "text"; text: string }
  | { kind: "tool"; result: ToolResult }
  | { kind: "error"; error: Error };

const queue: Scripted[] = [];
const calls: { method: string; system: string; lastUserMessage: string }[] = [];

// Test controls. Each scripted item answers exactly one call, in order.
export const fakeLlm = {
  push: (...items: Scripted[]) => queue.push(...items),
  reset: () => {
    queue.length = 0;
    calls.length = 0;
  },
  calls: () => [...calls],
};

const USAGE: Usage = { inputTokens: 100, outputTokens: 20 };

const next = (
  method: string,
  system: string,
  messages: { role: string; content: string }[],
) => {
  const lastUserMessage =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  calls.push({ method, system, lastUserMessage });
  const item = queue.shift();
  if (item?.kind === "error") throw item.error;
  return { item, lastUserMessage };
};

// Heuristics for unscripted calls (E2E). Deliberately crude.
const routeByKeywords = (text: string) => {
  const t = text.toLowerCase();
  if (/(lawyer|consultation|call me|talk to|@|\d{3}[-.\s]\d{4})/.test(t))
    return "wants_lawyer";
  if (/(will i|should i|my case|am i going)/.test(t)) return "legal_advice";
  if (/(python|poem|pizza|ignore (all|your)|system prompt)/.test(t))
    return "out_of_scope";
  if (/^(hi|hello|hey|thanks|thank you)\b/.test(t)) return "small_talk";
  return "question";
};

const extractLead = (text: string): ToolResult => {
  const phone = text.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]\d{4}/)?.[0];
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0];
  const name = text
    .split(",")[0]
    ?.replace(/^(i'?m|my name is)\s+/i, "")
    .trim();
  const caseType = /dui|drunk/i.test(text)
    ? "dui"
    : /divorce|custody/i.test(text)
      ? "family_law"
      : /accident|injur/i.test(text)
        ? "personal_injury"
        : null;
  if (name && (phone || email) && caseType) {
    return {
      type: "tool_call",
      name: "createLead",
      args: { name, phone, email, caseType },
    };
  }
  return {
    type: "text",
    text: "Could you share your name, a phone number or email, and the type of case?",
  };
};

export const createFakeProvider = (): LlmProvider => ({
  name: "gemini",
  model: "fake",

  async generateJson({ system, messages, schema }) {
    const { item, lastUserMessage } = next("generateJson", system, messages);
    const data =
      item?.kind === "json"
        ? item.data
        : system === routerV1.system
          ? { intent: routeByKeywords(lastUserMessage), reason: "fake" }
          : {};
    return { data: schema.parse(data), usage: USAGE };
  },

  async *streamText({ system, messages }) {
    const { item } = next("streamText", system, messages);
    const text =
      item?.kind === "text"
        ? item.text
        : "Harbor & Vale Law can help with that [1].";
    for (const word of text.split(/(?<= )/))
      yield { type: "text", text: word } satisfies StreamEvent;
    yield { type: "done", usage: USAGE };
  },

  async callTools({ system, messages }) {
    const { item, lastUserMessage } = next("callTools", system, messages);
    const result =
      item?.kind === "tool"
        ? item.result
        : item?.kind === "text"
          ? { type: "text" as const, text: item.text }
          : extractLead(lastUserMessage);
    return { result, usage: USAGE };
  },
});
