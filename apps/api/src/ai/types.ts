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

export type ToolSpec = { name: string; description: string; schema: z.ZodType };

export type ToolResult =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; args: unknown };

export type ToolRequest = {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  signal: AbortSignal;
};

// Every provider translates these shapes to and from its own API. Services never see a provider type.
export interface LlmProvider {
  readonly name: "nvidia" | "gemini";
  readonly model: string;
  generateJson<T>(request: JsonRequest<T>): Promise<{ data: T; usage: Usage }>;
  callTools(
    request: ToolRequest,
  ): Promise<{ result: ToolResult; usage: Usage }>;
  streamText(request: TextRequest): AsyncIterable<StreamEvent>;
}
