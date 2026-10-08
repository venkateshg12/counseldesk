import type { ChatRequest } from "@repo/types";

export class ChatHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// Opens the chat stream. Errors detected before streaming (validation, rate limit) come back as a
// normal JSON envelope, turned into a ChatHttpError with the server's message.
export const postChat = async (
  apiUrl: string,
  body: ChatRequest,
  signal?: AbortSignal,
) => {
  const response = await fetch(`${apiUrl}/chat`, {
    method: "POST",
    credentials: "include", // sends the visitorId cookie that owns the conversation
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    const envelope = (await response.json().catch(() => null)) as {
      errors?: { message?: string }[];
    } | null;
    throw new ChatHttpError(
      envelope?.errors?.[0]?.message ??
        "Something went wrong. Please try again.",
      response.status,
    );
  }
  return response;
};
