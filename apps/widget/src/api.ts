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

// Books the slot the visitor tapped. The server takes the person's details from the lead it already
// saved for this conversation, so only the chosen time is sent.
export const bookInChat = async (
  apiUrl: string,
  conversationId: string,
  startsAt: string,
) => {
  const response = await fetch(`${apiUrl}/chat/${conversationId}/book`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ startsAt }),
  });
  const envelope = (await response.json().catch(() => null)) as {
    data?: { startsAt: string; attorney: { name: string } };
    errors?: { message?: string }[];
  } | null;
  if (!response.ok || !envelope?.data) {
    throw new ChatHttpError(
      envelope?.errors?.[0]?.message ??
        "Couldn't book that time. Please try another.",
      response.status,
    );
  }
  return envelope.data;
};
