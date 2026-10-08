import {
  FunctionCallingConfigMode,
  ThinkingLevel,
  type Content,
  type GenerateContentResponseUsageMetadata,
} from "@google/genai";
import { z } from "zod";
import { gemini } from "../gemini.js";
import type { ChatMessage, LlmProvider, Usage } from "../types.js";
import { GEMINI_THINKING_LEVEL } from "../../constants/env.js";

const THINKING_LEVELS: Record<string, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};
const thinkingLevel =
  THINKING_LEVELS[GEMINI_THINKING_LEVEL] ?? ThinkingLevel.LOW;

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
        thinkingConfig: { thinkingLevel },
        abortSignal: signal,
      },
    });
    return {
      data: schema.parse(JSON.parse(response.text ?? "")),
      usage: toUsage(response.usageMetadata),
    };
  },

  async callTools({ system, messages, tools, signal }) {
    const response = await gemini.models.generateContent({
      model,
      contents: toContents(messages),
      config: {
        systemInstruction: system,
        temperature: 0,
        thinkingConfig: { thinkingLevel },
        tools: [
          {
            functionDeclarations: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parametersJsonSchema: toResponseSchema(tool.schema),
            })),
          },
        ],
        // AUTO: the model chooses between replying with text and calling a tool.
        toolConfig: {
          functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO },
        },
        abortSignal: signal,
      },
    });

    const call = response.functionCalls?.[0];
    if (call?.name) {
      return {
        result: {
          type: "tool_call",
          name: call.name,
          args: call.args ?? {},
        },
        usage: toUsage(response.usageMetadata),
      };
    }
    const text = response.text?.trim();
    // An empty reply is a failed attempt, so the fallback gets its turn.
    if (!text) throw new Error("Empty model response");
    return {
      result: { type: "text", text },
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
        thinkingConfig: { thinkingLevel },
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
