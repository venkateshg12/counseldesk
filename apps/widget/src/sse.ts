import type { ChatEvent } from "@repo/types";

// Yields complete SSE events from a streamed body. A network chunk may end mid-event, so the
// unfinished tail stays in the buffer until the rest arrives.
export async function* readEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    // stream: true keeps an incomplete multi-byte character for the next chunk instead of mangling it.
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");
      // Comment lines (": ping") have no data and are skipped.
      if (data) yield JSON.parse(data) as ChatEvent;
      boundary = buffer.indexOf("\n\n");
    }
  }
}
