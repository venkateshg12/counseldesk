# Phase 16 — The streaming chat endpoint (SSE)

## 1. Goal

`POST /chat` — the endpoint the widget will call. It takes `{ conversationId?, message }`, and
answers with a **Server-Sent Events** stream: the conversation id first, then the answer word by
word, then the citations, then a `done` event. User and assistant messages and their citations are
saved; a visitor can only continue their own conversation.

The pipeline lives in one function, `handleMessage()`, that **emits events through a callback**. The
HTTP controller turns events into SSE; the eval runner (Phase 22) calls the same function with a
callback that collects them. Evals therefore test exactly the code real visitors hit.

## 2. What I will understand after this phase

1. What SSE is, its wire format, and why it fits "stream an answer" better than WebSockets.
2. Why the endpoint is a `POST` read with `fetch`, not the browser's `EventSource`.
3. How errors work once a `200` and streaming headers have already been sent.
4. What happens when the visitor closes the tab mid-answer, and how the model call is cancelled.
5. Why proxies need a heartbeat and `X-Accel-Buffering: no`.

## 3. Prerequisites

- Phase 15 done: `ask` gives grounded, cited answers.

## 4. Files

```
packages/types/src/chat.ts               (chatRequestSchema, ChatEvent)
apps/api/src/
├── services/chat.service.ts             NEW  handleMessage
├── controllers/chat.controller.ts       NEW  SSE adapter
├── routes/chat.route.ts                 NEW  limiters + handler
└── app.ts                               (mount /chat)
```

## 5. Concepts

**SSE.** An HTTP response that stays open and sends text events as they happen:

```
event: token
data: {"type":"token","text":"Our "}

event: token
data: {"type":"token","text":"fee starts at"}

```

Each event is `event:` and `data:` lines followed by a blank line. It's plain HTTP, one direction
(server → browser), works through ordinary proxies, and needs no extra protocol. WebSockets are
two-way and stateful — useful for multiplayer apps, overkill for "send a question, stream the answer".

**Why `POST` + `fetch`.** The browser's built-in `EventSource` can only make `GET` requests with no
body. A chat message belongs in a request body (URLs end up in logs and history), so the widget uses
`fetch` and reads the response stream itself (Phase 33). The server side is identical either way.

**Errors after headers.** Once the status line `200` and the headers have been sent, the status can't
change. So errors are split in two:

- **before streaming** (invalid body, rate limit): the normal JSON envelope with a 4xx, via the error
  handler;
- **during streaming** (model unavailable, database error): an `error` event in the stream, then the
  stream ends. The widget handles both.

**The visitor leaves.** When the browser closes the connection, Express's response emits `close`
before it has finished. The controller aborts an `AbortController` whose signal reaches the model
call (Phase 14), so generation — and billing — stops. Nothing is saved for the half-finished
answer: an assistant message nobody saw would only confuse the staff transcript.

**Heartbeats and buffering.** Some proxies close connections that send nothing for a while (the
first token can take a few seconds, longer on a cold server), and some buffer a response until it's
complete — which defeats streaming. A comment line (`: ping`) every 15 seconds keeps the connection
alive; `X-Accel-Buffering: no` tells nginx-style proxies not to buffer; `Cache-Control: no-transform`
stops intermediaries compressing (and therefore buffering) it.

**Who owns a conversation.** The conversation id travels in the request body, so anyone could send
someone else's id. Each conversation stores the `visitorId` cookie of the browser that started it;
continuing requires the same cookie, otherwise it's "not found" (not "forbidden", which would
confirm the id exists).

**Saving atomically.** The assistant message, its citation rows and the conversation's `updatedAt`
are written in one transaction: a transcript never shows an answer whose citations are missing.

## 6. Steps

### Step 1 — Shared request and event types

Append to `packages/types/src/chat.ts`:

```ts
import { z } from "zod";

export const chatRequestSchema = z.object({
  conversationId: z.uuid().optional(),
  message: z
    .string()
    .trim()
    .min(1, { message: "Message is empty" })
    .max(1000, { message: "Message is too long" }),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

// Everything the chat stream can send, in order: meta, token*, citations, done — or error at any point.
export type ChatEvent =
  | { type: "meta"; conversationId: string }
  | { type: "token"; text: string }
  | { type: "citations"; citations: Citation[] }
  | {
      type: "done";
      messageId: string;
      intent: string | null;
      notice: string | null;
      degraded: boolean;
    }
  | { type: "error"; message: string; code: string };
```

(Put the `import` at the top of the file, above `Citation`.) `intent` becomes a typed union in Phase
17; `notice` is filled in Phase 17 too.

### Step 2 — `src/services/chat.service.ts`

```ts
import type { ChatEvent } from "@repo/types";
import { db, orm } from "../prisma/db.js";
import { appAssert } from "../utils/errors/index.js";
import { NOT_FOUND } from "../constants/http.js";
import { prepareAnswer } from "./answer.service.js";
import { streamText } from "../ai/llm.js";
import { NOT_FOUND_REPLY } from "../ai/prompts/index.js";
import { extractCitations } from "../utils/citations.js";
import type { ChatMessage } from "../ai/types.js";
import type { SearchMode } from "../constants/search.js";

// Earlier turns given to the model and the router. Six messages = three exchanges.
const HISTORY_MESSAGES = 6;

type HandleMessageInput = {
  visitorId: string;
  conversationId?: string;
  message: string;
  signal: AbortSignal;
  emit: (event: ChatEvent) => void;
  // Evals only: run retrieval in one mode (Phase 23).
  mode?: SearchMode;
};

const loadHistory = async (conversationId: string): Promise<ChatMessage[]> => {
  const recent = await orm.Message.where({ conversationId })
    .orderBy((m) => m.createdAt.desc())
    .select("role", "content")
    .limit(HISTORY_MESSAGES)
    .all();
  return recent.reverse();
};

export const handleMessage = async ({
  visitorId,
  conversationId,
  message,
  signal,
  emit,
  mode,
}: HandleMessageInput) => {
  const startedAt = performance.now();

  // A visitor may only continue a conversation their own browser started.
  const conversation = conversationId
    ? await orm.Conversation.where({ id: conversationId, visitorId }).first()
    : await orm.Conversation.create({ visitorId });
  appAssert(conversation, NOT_FOUND, "Conversation not found");
  emit({ type: "meta", conversationId: conversation.id });

  const history = await loadHistory(conversation.id);
  await orm.Message.create({
    conversationId: conversation.id,
    role: "user",
    content: message,
  });

  const prepared = await prepareAnswer({ question: message, history, mode });

  let text = "";
  let firstTokenMs: number | null = null;

  if (prepared.sources.length === 0) {
    // Nothing to ground on: skip the model entirely.
    text = NOT_FOUND_REPLY;
    emit({ type: "token", text });
  } else {
    for await (const event of streamText({
      purpose: "answer",
      promptVersion: prepared.promptVersion,
      conversationId: conversation.id,
      system: prepared.system,
      messages: prepared.messages,
      signal,
    })) {
      if (event.type === "text") {
        if (firstTokenMs === null)
          firstTokenMs = Math.round(performance.now() - startedAt);
        text += event.text;
        emit({ type: "token", text: event.text });
      }
    }
  }

  // The visitor left mid-answer: nothing is saved for an answer nobody saw.
  if (signal.aborted) return null;

  const citations = extractCitations(text, prepared.sources);
  const totalMs = Math.round(performance.now() - startedAt);

  const assistantMessage = await db.transaction(async (tx) => {
    const saved = await tx.orm.public.Message.create({
      conversationId: conversation.id,
      role: "assistant",
      content: text,
      promptVersion: prepared.promptVersion,
      retrieveMs: prepared.retrieveMs,
      firstTokenMs,
      totalMs,
    });
    for (const citation of citations) {
      await tx.orm.public.MessageCitation.create({
        messageId: saved.id,
        sectionId: citation.sectionId,
        number: citation.number,
        url: citation.url,
        heading: citation.heading,
      });
    }
    await tx.orm.public.Conversation.where({ id: conversation.id }).update({
      updatedAt: new Date().toISOString(),
    });
    return saved;
  });

  emit({
    type: "citations",
    citations: citations.map(({ number, url, heading }) => ({
      number,
      url,
      heading,
    })),
  });
  emit({
    type: "done",
    messageId: assistantMessage.id,
    intent: null,
    notice: null,
    degraded: prepared.retrieval.degraded,
  });

  return {
    conversationId: conversation.id,
    messageId: assistantMessage.id,
    text,
    citations,
    prepared,
    totalMs,
    firstTokenMs,
  };
};
```

- `firstTokenMs` here is measured from the start of the **request** (what the visitor feels); the
  `llmCall` row measures from the start of the model call. Phase 20 reports both.
- The user message is saved before the model runs, so it's in the transcript even if generation
  fails. The history is loaded _before_ saving it, so the current question isn't duplicated in the
  prompt.
- `streamText` returns silently when `signal` is aborted (Phase 14), so the loop simply ends.
- The function returns everything the eval runner needs: answer text, citations, retrieved ids,
  timings.

### Step 3 — `src/controllers/chat.controller.ts`

```ts
import { chatRequestSchema, type ChatEvent } from "@repo/types";
import { catchError, AppError } from "../utils/errors/index.js";
import { OK } from "../constants/http.js";
import { handleMessage } from "../services/chat.service.js";
import { logger } from "../utils/logger.js";

const HEARTBEAT_MS = 15_000;

export const chatHandler = catchError(async (req, res) => {
  // Validated before any streaming starts, so a bad request still gets a normal 400 envelope.
  const { conversationId, message } = chatRequestSchema.parse(req.body);

  const controller = new AbortController();
  // `close` before the response finished means the visitor disconnected.
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  res.status(OK).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const send = (event: ChatEvent) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };
  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);

  try {
    await handleMessage({
      visitorId: req.visitorId!,
      conversationId,
      message,
      signal: controller.signal,
      emit: send,
    });
  } catch (error) {
    // Headers are already sent: the error goes into the stream, not into the status code.
    if (error instanceof AppError) {
      send({
        type: "error",
        message: error.message,
        code: error.errorCode ?? "APP_ERROR",
      });
    } else {
      logger.error("chat failed", { error });
      send({
        type: "error",
        message: "Something went wrong. Please try again.",
        code: "INTERNAL_SERVER_ERROR",
      });
    }
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});
```

- `res.flushHeaders()` sends the status and headers immediately, so the browser knows the stream is
  open before the first token.
- `req.visitorId!`: the `visitorId` middleware (Phase 08) runs on every request before routes, so
  it's always set here; the `!` documents that.
- `JSON.stringify` escapes newlines inside the text, so a token containing `\n\n` can't end the event
  early.

### Step 4 — `src/routes/chat.route.ts`

```ts
import { Router } from "express";
import { chatHandler } from "../controllers/chat.controller.js";
import { chatDailyLimiter, chatLimiter } from "../config/rateLimiter.js";

export const chatRoutes = Router();

// Daily cap first: it rejects the cheapest, most clearly abusive case before the short-window check.
chatRoutes.post("/", chatDailyLimiter, chatLimiter, chatHandler);
```

`app.ts`: `app.use("/chat", chatRoutes);`

## 7. Commit points

1. `feat(types): add chat request schema and event types`
2. `feat(api): add chat pipeline emitting events, with atomic message and citation saves`
3. `feat(api): stream chat over SSE with heartbeat, abort and in-stream errors`

## 8. Verify

```bash
# -N: don't buffer; -c/-b: keep the visitorId cookie between requests
curl -N -c /tmp/v -b /tmp/v -X POST localhost:4000/chat \
  -H 'content-type: application/json' -d '{"message":"Do you handle DUI cases in Phoenix?"}'
# event: meta      data: {"type":"meta","conversationId":"…"}
# event: token     data: {"type":"token","text":"Yes"} … (many)
# event: citations data: {"type":"citations","citations":[{"number":1,"url":"http://localhost:3000/practice-areas/dui#…","heading":"…"}]}
# event: done      data: {"type":"done","messageId":"…",…}

# Follow-up in the same conversation (paste the conversationId)
curl -N -c /tmp/v -b /tmp/v -X POST localhost:4000/chat -H 'content-type: application/json' \
  -d '{"conversationId":"<id>","message":"How much does that cost?"}'
# should cite /fees#dui-fees thanks to the previous question in the retrieval query

# Another browser (no cookie) can't continue it
curl -N -X POST localhost:4000/chat -H 'content-type: application/json' \
  -d '{"conversationId":"<id>","message":"hi"}'
# event: meta? no — event: error data: {"…","message":"Conversation not found"}

# Validation before streaming: normal 400 JSON
curl -s -X POST localhost:4000/chat -H 'content-type: application/json' -d '{"message":""}'

# Abort: start a request and press Ctrl+C after the first tokens; then
docker exec counseldesk-postgres psql -U counseldesk -d counseldesk -c \
  "SELECT role, left(content, 40) FROM message ORDER BY \"createdAt\" DESC LIMIT 2;"
# the user message is saved, no assistant message for that turn

# Rate limit: the 21st message within 10 minutes from one cookie → 429 JSON (before streaming)

# Saved data
docker exec counseldesk-postgres psql -U counseldesk -d counseldesk -c \
  "SELECT m.\"retrieveMs\", m.\"firstTokenMs\", m.\"totalMs\", count(c.id) AS citations FROM message m LEFT JOIN \"messageCitation\" c ON c.\"messageId\" = m.id WHERE m.role='assistant' GROUP BY m.id ORDER BY m.\"createdAt\" DESC LIMIT 3;"
```

## 9. Common mistakes

- **Adding `compression()` middleware.** It buffers the response to compress it, and the stream
  arrives all at once at the end.
- **Calling `res.status(500)` in the catch.** Headers are already sent; Express throws "Cannot set
  headers after they are sent".
- **Listening to `req.on("close")`.** On current Node the request emits `close` once its body has been
  read, long before the response finishes; use `res.on("close")` and check `writableEnded`.
- **Not aborting the model call** on disconnect: it keeps generating (and billing) for nobody.
- **Trusting `conversationId` alone.** Anyone could read or continue other visitors' chats by guessing
  or leaking ids.
- **`data:` with raw text.** A newline in the text breaks the event format; always JSON-encode.

## 10. Interview prep

**Q: Why SSE instead of WebSockets?**
A: The data flows one way — server to browser — per question. SSE is plain HTTP, proxy-friendly and
needs no connection management; WebSockets add a stateful two-way protocol I don't need.

**Q: How do you report an error after streaming has started?**
A: The status is already 200, so errors become an `error` event in the stream and the stream ends;
the client handles both that and normal 4xx JSON for errors detected before streaming.

**Q: What happens if the user closes the tab mid-answer?**
A: The response's `close` event aborts a controller whose signal reaches the provider SDK, so the
model request is cancelled. The partial answer isn't saved.

**Q: How do you keep the same code path for evals and production?**
A: The pipeline emits events through a callback; HTTP wraps it as SSE, the eval runner collects
events in memory. Nothing in the pipeline knows about HTTP.

## 11. Resume-safe claim

"Built a streaming chat endpoint over Server-Sent Events with cancellation propagated to the model on
disconnect, in-stream error events, ownership-checked conversations and atomic persistence of answers
and citations."

## 12. Definition of done

- [ ] `curl -N` shows meta → tokens → citations → done
- [ ] Follow-ups in the same conversation use the previous question
- [ ] A different visitor can't continue the conversation
- [ ] Invalid input returns 400 JSON; a model outage returns an `error` event
- [ ] Ctrl+C mid-stream cancels generation and saves no assistant message
- [ ] Message rows carry retrieve, first-token and total timings; citations are saved
