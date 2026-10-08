import { createHash } from "node:crypto";
import { nvidiaFetch } from "./nvidia.js";
import { LLM_PROVIDER, NVIDIA_EMBEDDING_MODEL } from "../constants/env.js";
import {
  EMBED_BATCH_SIZE,
  EMBEDDING_DIMENSIONS,
  queryInput,
} from "../constants/embedding.js";
import { recordLlmCall } from "../services/llmCall.service.js";

type NvidiaEmbeddingResponse = {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
};

const estimateTokens = (texts: string[]) =>
  Math.ceil(texts.join("").length / 4);

// Feature hashing: each word adds 1 to one of the dimensions; then normalise to length 1.
// Texts that share words point in similar directions, so cosine search stays meaningful offline.
const fakeEmbedding = (text: string) => {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const bucket =
      createHash("md5").update(word).digest().readUInt32BE(0) %
      EMBEDDING_DIMENSIONS;
    vector[bucket]! += 1;
  }
  const length = Math.hypot(...vector) || 1;
  return vector.map((v) => v / length);
};

const embedBatch = async (
  texts: string[],
  purpose: "embed_query" | "embed_document",
  inputType: "passage" | "query",
) => {
  if (LLM_PROVIDER === "fake") return texts.map(fakeEmbedding);

  const startedAt = performance.now();
  try {
    const response = await nvidiaFetch<NvidiaEmbeddingResponse>("/embeddings", {
      model: NVIDIA_EMBEDDING_MODEL,
      input: texts,
      input_type: inputType,
    });

    const vectors = (response.data ?? []).map((item) => item.embedding ?? []);
    if (
      vectors.length !== texts.length ||
      vectors.some((v) => v.length !== EMBEDDING_DIMENSIONS)
    ) {
      throw new Error(
        `Embedding shape mismatch: sent ${texts.length} texts, got ${vectors.length} vectors of length ${vectors[0]?.length}`,
      );
    }

    await recordLlmCall({
      purpose,
      provider: "nvidia",
      model: NVIDIA_EMBEDDING_MODEL,
      latencyMs: Math.round(performance.now() - startedAt),
      inputTokens: response.usage?.prompt_tokens ?? estimateTokens(texts),
      ok: true,
    });
    return vectors;
  } catch (error) {
    await recordLlmCall({
      purpose,
      provider: "nvidia",
      model: NVIDIA_EMBEDDING_MODEL,
      latencyMs: Math.round(performance.now() - startedAt),
      ok: false,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    throw error;
  }
};

// Texts must already be in document form (documentInput). Returns one vector per text, in order.
export const embedDocuments = async (texts: string[]) => {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    vectors.push(
      ...(await embedBatch(
        texts.slice(i, i + EMBED_BATCH_SIZE),
        "embed_document",
        "passage",
      )),
    );
  }
  return vectors;
};

export const embedQuery = async (question: string) => {
  const [vector] = await embedBatch(
    [queryInput(question)],
    "embed_query",
    "query",
  );
  return vector!;
};
