import { z } from "zod";
import { NVIDIA_CHAT_API_KEY } from "../../constants/env.js";
import { NVIDIA_BASE_URL } from "../nvidia.js";
import type { ChatMessage, LlmProvider, Usage } from "../types.js";

// Carries the HTTP status so isRetryable and the telemetry error code can read it.
class NvidiaApiError extends Error {
  constructor(
    public readonly status: number,
    body: string,
  ) {
    super(`NVIDIA chat API error (${status}): ${body.slice(0, 500)}`);
    this.name = "NvidiaApiError";
  }
}

type ChatUsage = { prompt_tokens?: number; completion_tokens?: number };

type ChatCompletion = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  usage?: ChatUsage | null;
};

const jsonSchemaOf = (schema: z.ZodType) => {
  const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema);
  return jsonSchema;
};

type ChatChunk = {
  choices?: Array<{ delta?: { content?: string | null } }>;
  usage?: ChatUsage | null;
};

const toUsage = (usage?: ChatUsage | null): Usage => ({
  inputTokens: usage?.prompt_tokens ?? 0,
  outputTokens: usage?.completion_tokens ?? 0,
});

// The endpoint is OpenAI-compatible, so one plain fetch covers it: no SDK, and nothing else
// retrying behind withRetry's back.
const postChat = async (body: object, signal: AbortSignal) => {
  const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NVIDIA_CHAT_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok)
    throw new NvidiaApiError(response.status, await response.text());
  return response;
};

const withSystem = (system: string, messages: ChatMessage[]) => [
  { role: "system", content: system },
  ...messages,
];

// Server-sent events: one "data: {json}" line per chunk, ended by "data: [DONE]".
async function* readSse(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload && payload !== "[DONE]") yield payload;
    }
  }
  if (buffer.startsWith("data:")) {
    const payload = buffer.slice(5).trim();
    if (payload && payload !== "[DONE]") yield payload;
  }
}

export const createNvidiaProvider = (model: string): LlmProvider => ({
  name: "nvidia",
  model,

  async generateJson({ system, messages, schema, signal }) {
    const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema);
    const response = await postChat(
      {
        model,
        temperature: 0,
        // Guarantees syntactically valid JSON; the shape is asked for in the prompt and checked by Zod.
        response_format: { type: "json_object" },
        messages: withSystem(
          `${system}\n\nRespond with only a JSON object that matches this JSON Schema:\n${JSON.stringify(jsonSchema)}`,
          messages,
        ),
      },
      signal,
    );
    const completion = (await response.json()) as ChatCompletion;
    const content = completion.choices?.[0]?.message?.content ?? "";
    const parsed = (() => {
      const trimmed = content.trim();
      const codeBlockMatch = trimmed.match(
        /^```(?:json)?\s*([\s\S]*?)\s*```$/i,
      );
      const text = codeBlockMatch ? codeBlockMatch[1]! : trimmed;
      try {
        return JSON.parse(text);
      } catch (err) {
        const first = text.indexOf("{");
        const last = text.lastIndexOf("}");
        if (first !== -1 && last > first) {
          return JSON.parse(text.slice(first, last + 1));
        }
        throw err;
      }
    })();
    return {
      data: schema.parse(parsed),
      usage: toUsage(completion.usage),
    };
  },

  async callTools({ system, messages, tools, signal }) {
    const response = await postChat(
      {
        model,
        temperature: 0,
        tool_choice: "auto",
        tools: tools.map((tool) => ({
          type: "function" as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: jsonSchemaOf(tool.schema),
          },
        })),
        messages: withSystem(system, messages),
      },
      signal,
    );

    const completion = (await response.json()) as ChatCompletion;
    const message = completion.choices?.[0]?.message;
    const call = message?.tool_calls?.[0];
    if (call) {
      return {
        result: {
          type: "tool_call",
          name: call.function.name,
          args: JSON.parse(call.function.arguments || "{}"),
        },
        usage: toUsage(completion.usage),
      };
    }
    const text = message?.content?.trim();
    if (!text) throw new Error("Empty model response");
    return { result: { type: "text", text }, usage: toUsage(completion.usage) };
  },

  async *streamText({ system, messages, signal }) {
    const response = await postChat(
      {
        model,
        temperature: 0.2,
        stream: true,
        // Without this the stream carries no token counts.
        stream_options: { include_usage: true },
        messages: withSystem(system, messages),
      },
      signal,
    );
    if (!response.body) throw new Error("NVIDIA chat stream had no body");

    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    for await (const payload of readSse(response.body)) {
      const chunk = JSON.parse(payload) as ChatChunk;
      // Usage is reported on the final chunk.
      if (chunk.usage) usage = toUsage(chunk.usage);
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) yield { type: "text", text };
    }
    yield { type: "done", usage };
  },
});
