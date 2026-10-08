// Fixed by the `vector(2048)` column in contract.prisma.
export const EMBEDDING_DIMENSIONS = 2048;

// NVIDIA nemotron-3-embed-1b takes title/heading in text and uses input_type (passage/query).
export const documentInput = (title: string, text: string) =>
  `${title}\n${text}`;
export const queryInput = (question: string) => question;

export const EMBED_BATCH_SIZE = 20;
