// USD per 1M tokens, paid tier, standard (non-batch) pricing. Read on: 2026-10-08. Update with the date.
// Because "USD per 1M tokens" equals "micro-USD per token", these multiply token counts directly.
export const PRICES_AS_OF = "2026-10-08";

export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  // https://ai.google.dev/gemini-api/docs/pricing — output includes thinking tokens.
  "gemini-3.5-flash": { input: 1.5, output: 9.0 },
  "gemini-3.6-flash": { input: 1.5, output: 9.0 },
  "gemini-embedding-2": { input: 0.15, output: 0 },
  // https://console.groq.com/docs/models
  "openai/gpt-oss-20b": { input: 0.075, output: 0.3 },
  // NVIDIA NIM models:
  "nvidia/nemotron-3-ultra-550b-a55b": { input: 0.8, output: 2.4 },
  "nvidia/nemotron-3-embed-1b": { input: 0.05, output: 0 },
  "baai/bge-m3": { input: 0.05, output: 0 },
  "meta/llama-3.1-70b-instruct": { input: 0.88, output: 0.88 },
};
