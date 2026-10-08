import { describe, expect, it } from "vitest";
import { readEvents } from "./sse";

// A stream that delivers the given strings as separate chunks.
const streamOf = (...chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks)
        controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });

const collect = async (stream: ReadableStream<Uint8Array>) => {
  const events = [];
  for await (const event of readEvents(stream)) events.push(event);
  return events;
};

describe("readEvents", () => {
  it("parses complete events", async () => {
    const events = await collect(
      streamOf('event: token\ndata: {"type":"token","text":"Hi"}\n\n'),
    );
    expect(events).toEqual([{ type: "token", text: "Hi" }]);
  });

  it("joins an event split across chunks", async () => {
    const events = await collect(
      streamOf('event: token\ndata: {"type":"tok', 'en","text":"Hi"}\n', "\n"),
    );
    expect(events).toEqual([{ type: "token", text: "Hi" }]);
  });

  it("handles several events in one chunk and skips heartbeats", async () => {
    const events = await collect(
      streamOf(
        ': ping\n\ndata: {"type":"token","text":"a"}\n\ndata: {"type":"token","text":"b"}\n\n',
      ),
    );
    expect(events.map((e) => (e.type === "token" ? e.text : ""))).toEqual([
      "a",
      "b",
    ]);
  });

  it("keeps a multi-byte character split across chunks intact", async () => {
    const bytes = new TextEncoder().encode(
      'data: {"type":"token","text":"é"}\n\n',
    );
    const cut = bytes.indexOf(0xc3) + 1; // split inside the two-byte "é"
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });
    expect(await collect(stream)).toEqual([{ type: "token", text: "é" }]);
  });
});
